// src/lib/server/db/dsql/migration/transform.ts
// EPIC #3424 / M4-B① カスタム migration runner (純変換層)
// 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.2 (F2/F3)
//   実測根拠: docs/research/dsql-poc-phase1-results-2026-07-05.md 検証 2 (#3427)
//
// drizzle-kit(pg) の generate 出力 SQL は DSQL 非互換 (検証 2 で実 error code 確定)。
// 本モジュールは drizzle-kit 出力 SQL テキストを DSQL DDL へ**後処理変換する純関数**。
// 副作用なし・実行なし。実適用 (autocommit / ASYNC build poll) は runner.ts が担う。
//
// ⚠️ 入力前提 (drizzle-kit generate 出力): 文は `--> statement-breakpoint` 区切り、識別子は
//    二重引用、schema は `public` (drizzle.config)。**手書き SQL / function body (`$$…$$`) /
//    複雑な PL/pgSQL は想定外**。想定外入力は fail-close (明示 throw か DSQL apply 時 error)
//    になるよう保守的に設計する (silent 誤変換で fail-open しない)。
//
// 変換 6 責務 (検証 2 の実 error code に 1:1 対応):
//   1. FK 除去          — `ALTER TABLE ADD CONSTRAINT … FOREIGN KEY` / inline `REFERENCES` を除去
//                         (実測: 0A000 `unsupported ALTER TABLE ADD CONSTRAINT` /
//                          `FOREIGN KEY constraint not supported`)。参照整合は app 層 relations()+fitness。
//   2. ASYNC index 化   — `CREATE (UNIQUE) INDEX … USING btree` → `CREATE (UNIQUE) INDEX ASYNC …`
//                         (実測: 0A000 `USING not supported` / `please use CREATE INDEX ASYNC`)。
//   3. ASYNC build poll — runner.ts が担う (本モジュールは asyncIndexName を抽出して橋渡し)。
//   4. 1 DDL/txn         — runner.ts が各文を autocommit で適用 (本モジュールは文単位に分割)。
//                         (実測: 0A000 `multiple ddl statements not supported in a transaction`)。
//   5. SERIAL/SEQUENCE   — SERIAL は reject (UUID PK 前提)。明示 SEQUENCE は CACHE≥65536 or =1 のみ許容。
//                         (実測: 42704 `type "serial" does not exist` /
//                          0A000 `CREATE SEQUENCE is not supported without an explicit cache size`)。
//   6. DDL/DML 非混在    — 各文を kind (ddl/dml) 付きで source 順 statements に保持し、runner が
//                         per-statement autocommit で適用 (同一 txn に混在させない、#3928)。
//                         (実測: 0A000 `ddl and dml are not supported in the same transaction`)。

/** DSQL に適用可能な 1 文の DDL/DML。 */
export interface DsqlStatement {
	/** 適用する単一 SQL 文 (末尾 `;` なし)。 */
	sql: string;
	/**
	 * `CREATE (UNIQUE) INDEX ASYNC` の場合の index 識別子 (引用を外した実名。空白/ハイフンを含みうる)。
	 * runner が適用後に sys.jobs INDEX_BUILD=completed を poll するために使う (責務 3、F3)。
	 */
	asyncIndexName?: string;
}

/** source 順の適用単位。kind は観測 hook / 表示用の分類 (適用 semantics は同一 = autocommit 1 文)。 */
export interface DsqlPlannedStatement extends DsqlStatement {
	kind: 'ddl' | 'dml';
}

/**
 * drizzle-kit 出力 SQL を DSQL 用に変換した適用計画。
 * runner は **statements を source 順に、各文 autocommit (1 文/txn) で適用**する (#3928)。
 * DSQL 制約 (責務 4/6) は「同一 txn に複数 DDL / DDL⇄DML を混在させない」であり、per-statement
 * autocommit で満たされる。旧「DDL 全適用 → DML」の並び替えは DDL→DML→DDL 型 migration
 * (0004 fold: CREATE shell → INSERT fold → DROP) の依存順序を壊すため廃止した。
 * ddl / dml は statements から導出される分類 view (dry-run 表示 / ASYNC 集計用)。
 */
export interface DsqlMigrationPlan {
	statements: DsqlPlannedStatement[];
	ddl: DsqlStatement[];
	dml: DsqlStatement[];
}

/** drizzle-kit の文区切りマーカ。generate 出力の各文はこれで区切られる。 */
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

// FK 末尾に付きうる修飾 (ON DELETE/UPDATE, MATCH, DEFERRABLE) を貪欲に消費して孤立断片を残さない。
const ON_ACTION = '(?:NO\\s+ACTION|CASCADE|RESTRICT|SET\\s+NULL|SET\\s+DEFAULT)';
const FK_MODIFIER =
	`(?:\\s+ON\\s+(?:DELETE|UPDATE)\\s+${ON_ACTION}` +
	'|\\s+MATCH\\s+(?:FULL|PARTIAL|SIMPLE)' +
	'|\\s+(?:NOT\\s+)?DEFERRABLE' +
	'|\\s+INITIALLY\\s+(?:DEFERRED|IMMEDIATE))*';

// 参照先 `[schema.]table (col, …)`。列リストは入れ子括弧を持たないため `[^)]*`。
const REF_TARGET = '(?:"[^"]+"|\\w+)(?:\\.(?:"[^"]+"|\\w+))?\\s*\\([^)]*\\)';
// 表レベル FK: `[CONSTRAINT "x" ] FOREIGN KEY (…) REFERENCES … [modifiers]`。
const TABLE_FK_RE = new RegExp(
	`(?:CONSTRAINT\\s+"[^"]+"\\s+)?FOREIGN\\s+KEY\\s*\\([^)]*\\)\\s*REFERENCES\\s+${REF_TARGET}${FK_MODIFIER}`,
	'gi',
);
// 列レベル inline FK: `… REFERENCES … [modifiers]` (FOREIGN KEY prefix なし)。
const COLUMN_REF_RE = new RegExp(`\\s+REFERENCES\\s+${REF_TARGET}${FK_MODIFIER}`, 'gi');

// ── string-literal 保護 ─────────────────────────────────────────────────────
// 単一引用文字列内の `REFERENCES` / `serial` 等を誤変換しないよう、FK 除去や型検査の前に
// 文字列リテラルを sentinel placeholder に退避する。二重引用 (識別子) は FK/型検査の
// 対象文脈にしか現れないため退避しない (列名 `"REFERENCES"` はキーワード regex の
// `\sREFERENCES\s` に前後の `"` があって一致しない)。
const STRING_LITERAL_RE = /'(?:[^']|'')*'/g;

// placeholder 用の Unicode 私用領域 sentinel (SQL DDL に現れ得ず、制御文字でもない)。
const MASK_OPEN = '';
const MASK_CLOSE = '';
const MASK_RESTORE_RE = new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g');

/** 単一引用文字列を placeholder へ退避する。restore で元に戻す。 */
function maskStringLiterals(stmt: string): { masked: string; literals: string[] } {
	const literals: string[] = [];
	const masked = stmt.replace(STRING_LITERAL_RE, (m) => {
		const token = `${MASK_OPEN}${literals.length}${MASK_CLOSE}`;
		literals.push(m);
		return token;
	});
	return { masked, literals };
}

function restoreStringLiterals(masked: string, literals: string[]): string {
	return masked.replace(MASK_RESTORE_RE, (_, i) => literals[Number(i)] ?? '');
}

/** 型検査用: 単一引用文字列 + 二重引用識別子の両方を空白へ潰した「構造だけ」のテキスト。 */
function stripLiteralsAndIdents(stmt: string): string {
	return stmt.replace(STRING_LITERAL_RE, ' ').replace(/"(?:[^"]|"")*"/g, ' ');
}

/** 生入力を文単位に分割する。breakpoint 優先、無ければ trailing `;` で分割。 */
function splitStatements(sqlText: string): string[] {
	// ⚠️ drizzle-kit 出力前提: block comment / `$$…$$` 関数本体は想定しない。含む場合は
	//    分割が壊れうるため fail-close 側 (誤結合で DSQL apply error) に倒す。
	const withoutBlockComments = sqlText.replace(/\/\*[\s\S]*?\*\//g, '');
	const raw = withoutBlockComments.includes(STATEMENT_BREAKPOINT)
		? withoutBlockComments.split(STATEMENT_BREAKPOINT)
		: withoutBlockComments.split(/;\s*(?:\r?\n|$)/);
	return raw
		.map((s) =>
			s
				// 行コメントを除去 (breakpoint マーカ自身も `--` なので分割後に残らないが念のため)。
				.replace(/^\s*--.*$/gm, '')
				.trim()
				.replace(/;\s*$/, '') // 末尾 `;` を除去 (autocommit で 1 文適用するため不要)。
				.trim(),
		)
		.filter((s) => s.length > 0);
}

/** 大文字先頭キーワードで文種別を判定するための正規化ヘルパ。 */
function startsWith(stmt: string, keyword: string): boolean {
	return new RegExp(`^${keyword}\\b`, 'i').test(stmt.trimStart());
}

/** CREATE TABLE 文から inline / 表レベル FK を除去し、余った comma を掃除する (文字列リテラル保護)。 */
function stripForeignKeys(stmt: string): string {
	const { masked, literals } = maskStringLiterals(stmt);
	let out = masked.replace(TABLE_FK_RE, '').replace(COLUMN_REF_RE, '');
	// FK 除去で発生する dangling comma を掃除。
	out = out
		.replace(/,(\s*,)+/g, ',') // 連続 comma
		.replace(/\(\s*,/g, '(') // 開き括弧直後の comma
		.replace(/,(\s*)\)/g, '$1)'); // 閉じ括弧直前の comma
	return restoreStringLiterals(out, literals);
}

/** SERIAL/擬似型を「型宣言文脈」でのみ検出して拒否する (責務 5、UUID PK 前提)。 */
function assertNoSerial(stmt: string): void {
	// 列名 `"serial"` や DEFAULT 'serial' で誤 throw しないよう、識別子/文字列を潰したうえで検査。
	if (/\b(?:big|small)?serial\b/i.test(stripLiteralsAndIdents(stmt))) {
		throw new Error(
			'[dsql-migration] SERIAL/BIGSERIAL/SMALLSERIAL is not supported by DSQL ' +
				'(PoC 検証 2: 42704 `type "serial" does not exist`). Use UUID PK (gen_random_uuid()). ' +
				`offending statement: ${stmt.slice(0, 120)}…`,
		);
	}
}

/** CREATE SEQUENCE の CACHE 準拠を検証する (責務 5)。非準拠は throw。 */
function assertSequenceCacheCompliant(stmt: string): void {
	const m = stmt.match(/\bCACHE\s+(\d+)\b/i);
	const cache = m ? Number(m[1]) : null;
	if (cache === null || !(cache === 1 || cache >= 65536)) {
		throw new Error(
			'[dsql-migration] CREATE SEQUENCE requires an explicit CACHE >= 65536 or = 1 ' +
				'(PoC 検証 2: 0A000 `CREATE SEQUENCE is not supported without an explicit cache size`). ' +
				`offending statement: ${stmt.slice(0, 120)}…`,
		);
	}
}

/** 引用/非引用 index 識別子の実名を取り出す。`"a b"`→`a b` / `foo`→`foo`。 */
function unquoteIdent(raw: string): string {
	const t = raw.trim();
	if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/""/g, '"');
	return t;
}

/**
 * `CREATE (UNIQUE) INDEX` を DSQL 形式へ変換する。
 * - `USING <method>` 節を除去 (責務 2)。
 * - `INDEX` の直後に `ASYNC` を注入 (既に ASYNC なら二重付与しない)。
 * - index 名 (引用実名を保持) を poll 用に抽出する。
 */
function transformIndex(stmt: string): DsqlStatement {
	let out = stmt.replace(/\s+USING\s+\w+\s*/i, ' ');
	if (!/\bINDEX\s+ASYNC\b/i.test(out)) {
		out = out.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)(\s+)/i, '$1 ASYNC$2');
	}
	out = out.replace(/\s+/g, ' ').trim();
	// 引用名 (空白/ハイフン等を含みうる) は完全一致で捕捉し silent 切詰めを防ぐ。
	const nameMatch = out.match(
		/CREATE\s+(?:UNIQUE\s+)?INDEX\s+ASYNC\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|\w+)/i,
	);
	const captured = nameMatch?.[1];
	if (!captured) {
		throw new Error(`[dsql-migration] could not extract index name from: ${stmt.slice(0, 120)}…`);
	}
	return { sql: out, asyncIndexName: unquoteIdent(captured) };
}

/**
 * `ALTER TABLE … ADD CONSTRAINT … UNIQUE (…)` を `CREATE UNIQUE INDEX ASYNC` へ変換する。
 * DSQL は `ALTER TABLE ADD CONSTRAINT` 非対応 (検証 2) ゆえ ASYNC UNIQUE INDEX へ倒す
 * (build poll 対象になる)。非 UNIQUE (PRIMARY KEY/CHECK) の ADD CONSTRAINT は本関数の外で throw。
 */
function transformUniqueAlterToAsyncIndex(stmt: string): DsqlStatement {
	const m = stmt.match(
		/^ALTER\s+TABLE\s+(?:ONLY\s+)?("[^"]+"|[\w.]+)\s+ADD\s+CONSTRAINT\s+("[^"]+"|\w+)\s+UNIQUE\s*\(([^)]*)\)/i,
	);
	if (!m) {
		throw new Error(
			`[dsql-migration] could not parse UNIQUE ALTER for ASYNC conversion: ${stmt.slice(0, 120)}…`,
		);
	}
	const [, table, name, cols] = m;
	return transformIndex(`CREATE UNIQUE INDEX ${name} ON ${table} (${cols})`);
}

/**
 * drizzle-kit(pg) generate 出力 SQL を DSQL 用に変換する (純関数・実行なし)。
 *
 * @param sqlText drizzle-kit generate が出力した migration SQL (breakpoint 区切り可)。
 * @returns 適用計画 (ddl 先・dml 後、各文は autocommit で 1 文適用される想定)。
 * @throws SERIAL 検出時 / 非準拠 CREATE SEQUENCE 時 / 非 FK・非 UNIQUE の ADD CONSTRAINT ALTER 時。
 */
export function transformDrizzleSqlToDsql(sqlText: string): DsqlMigrationPlan {
	const raw = splitStatements(sqlText);
	const statements: DsqlPlannedStatement[] = [];
	// source 順を保持したまま分類 view へも積む helper (#3928)。
	const pushDdl = (s: DsqlStatement) => statements.push({ ...s, kind: 'ddl' });
	const pushDml = (s: DsqlStatement) => statements.push({ ...s, kind: 'dml' });

	for (const stmt of raw) {
		// ── ALTER TABLE … ADD CONSTRAINT の網羅処理 (責務 1 + fail-close) ──
		// DSQL は `ALTER TABLE ADD CONSTRAINT` を非対応 (検証 2)。制約種別ごとに:
		//   FK     → 除去 (app 層 relations() + fitness で整合担保)
		//   UNIQUE → CREATE UNIQUE INDEX ASYNC へ変換 (build poll 対象)
		//   PK/CHECK/その他 → 明示 throw (CREATE TABLE inline へ寄せるべき。silent 通過で
		//                     DSQL apply 時に 0A000 fail-close するより早く・明確に落とす)
		if (
			startsWith(stmt, 'ALTER\\s+TABLE') &&
			/\bADD\s+CONSTRAINT\b/i.test(stripLiteralsAndIdents(stmt))
		) {
			const structural = stripLiteralsAndIdents(stmt);
			if (/\bFOREIGN\s+KEY\b/i.test(structural)) {
				continue; // FK 除去
			}
			if (/\bUNIQUE\b/i.test(structural)) {
				pushDdl(transformUniqueAlterToAsyncIndex(stmt));
				continue;
			}
			throw new Error(
				'[dsql-migration] unsupported `ALTER TABLE … ADD CONSTRAINT` (PRIMARY KEY/CHECK/other). ' +
					'DSQL は ADD CONSTRAINT 非対応 (PoC 検証 2: 0A000)。PK/CHECK は CREATE TABLE inline へ、' +
					'UNIQUE は CREATE UNIQUE INDEX ASYNC へ表現し直すこと。 ' +
					`offending statement: ${stmt.slice(0, 120)}…`,
			);
		}

		// 責務 6: DML (seed) は別リストへ。
		if (startsWith(stmt, 'INSERT') || startsWith(stmt, 'UPDATE') || startsWith(stmt, 'DELETE')) {
			pushDml({ sql: stmt });
			continue;
		}

		// 責務 2: index は ASYNC 化。
		if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(stmt.trimStart())) {
			pushDdl(transformIndex(stmt));
			continue;
		}

		// 責務 5: SEQUENCE は CACHE 準拠を検証。
		if (startsWith(stmt, 'CREATE\\s+SEQUENCE')) {
			assertSequenceCacheCompliant(stmt);
			pushDdl({ sql: stmt });
			continue;
		}

		// 責務 5 + 1: CREATE TABLE は SERIAL 拒否 + inline/表レベル FK 除去。
		if (startsWith(stmt, 'CREATE\\s+TABLE')) {
			assertNoSerial(stmt);
			pushDdl({ sql: stripForeignKeys(stmt) });
			continue;
		}

		// その他 DDL (CREATE TYPE / ALTER TABLE ADD COLUMN 等) はそのまま DDL として保持。
		pushDdl({ sql: stmt });
	}

	const toView = ({ kind: _kind, ...rest }: DsqlPlannedStatement): DsqlStatement => rest;
	return {
		statements,
		ddl: statements.filter((s) => s.kind === 'ddl').map(toView),
		dml: statements.filter((s) => s.kind === 'dml').map(toView),
	};
}
