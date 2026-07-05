// src/lib/server/db/dsql/migration/transform.ts
// EPIC #3424 / M4-B① カスタム migration runner (純変換層)
// 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.2 (F2/F3)
//   実測根拠: docs/research/dsql-poc-phase1-results-2026-07-05.md 検証 2 (#3427)
//
// drizzle-kit(pg) の generate 出力 SQL は DSQL 非互換 (検証 2 で実 error code 確定)。
// 本モジュールは drizzle-kit 出力 SQL テキストを DSQL DDL へ**後処理変換する純関数**。
// 副作用なし・実行なし。実適用 (autocommit / ASYNC build poll) は runner.ts が担う。
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
//   6. DDL/DML 分離      — DDL と seed(DML) を別リストへ (runner が別 txn で適用)。
//                         (実測: 0A000 `ddl and dml are not supported in the same transaction`)。

/** DSQL に適用可能な 1 文の DDL/DML。 */
export interface DsqlStatement {
	/** 適用する単一 SQL 文 (末尾 `;` なし)。 */
	sql: string;
	/**
	 * `CREATE (UNIQUE) INDEX ASYNC` の場合の index 名 (unquoted)。
	 * runner が適用後に sys.jobs INDEX_BUILD=completed を poll するために使う (責務 3、F3)。
	 */
	asyncIndexName?: string;
}

/**
 * drizzle-kit 出力 SQL を DSQL 用に変換した適用計画。
 * runner は **ddl を全て適用 (各 autocommit + ASYNC poll) → その後 dml を別 txn で適用**する
 * (責務 4/6、DDL⇄DML 混在禁止)。
 */
export interface DsqlMigrationPlan {
	ddl: DsqlStatement[];
	dml: DsqlStatement[];
}

/** drizzle-kit の文区切りマーカ。generate 出力の各文はこれで区切られる。 */
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

const ON_ACTION = '(?:NO\\s+ACTION|CASCADE|RESTRICT|SET\\s+NULL|SET\\s+DEFAULT)';
const ON_CLAUSE = `(?:\\s+ON\\s+(?:DELETE|UPDATE)\\s+${ON_ACTION})*`;

// 表レベル FK 制約: `[CONSTRAINT "x" ] FOREIGN KEY (…) REFERENCES [schema.]table (…) [ON …]`。
// 列リストは入れ子括弧を持たないため `[^)]*` で十分。
const TABLE_FK_RE = new RegExp(
	`(?:CONSTRAINT\\s+"[^"]+"\\s+)?FOREIGN\\s+KEY\\s*\\([^)]*\\)\\s*REFERENCES\\s+(?:"?\\w+"?\\.)?"?\\w+"?\\s*\\([^)]*\\)${ON_CLAUSE}`,
	'gi',
);
// 列レベル inline FK: `… REFERENCES [schema.]table (…) [ON …]` (FOREIGN KEY prefix なし)。
const COLUMN_REF_RE = new RegExp(
	`\\s+REFERENCES\\s+(?:"?\\w+"?\\.)?"?\\w+"?\\s*\\([^)]*\\)${ON_CLAUSE}`,
	'gi',
);

/** 生入力を文単位に分割する。breakpoint 優先、無ければ trailing `;` で分割。 */
function splitStatements(sqlText: string): string[] {
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

/** CREATE TABLE 文から inline / 表レベル FK を除去し、余った comma を掃除する。 */
function stripForeignKeys(stmt: string): string {
	let out = stmt.replace(TABLE_FK_RE, '').replace(COLUMN_REF_RE, '');
	// FK 除去で発生する dangling comma を掃除。
	out = out
		.replace(/,(\s*,)+/g, ',') // 連続 comma
		.replace(/\(\s*,/g, '(') // 開き括弧直後の comma
		.replace(/,(\s*)\)/g, '$1)'); // 閉じ括弧直前の comma
	return out;
}

/** SERIAL/擬似型を含む CREATE TABLE を拒否する (責務 5、UUID PK 前提)。 */
function assertNoSerial(stmt: string): void {
	if (/\b(?:big|small)?serial\b/i.test(stmt)) {
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

/**
 * `CREATE (UNIQUE) INDEX` を DSQL 形式へ変換する。
 * - `USING <method>` 節を除去 (責務 2)。
 * - `INDEX` の直後に `ASYNC` を注入 (既に ASYNC なら二重付与しない)。
 * 戻り値に asyncIndexName (poll 用) を含める。
 */
function transformIndex(stmt: string): DsqlStatement {
	let out = stmt.replace(/\s+USING\s+\w+\s*/i, ' ');
	if (!/\bINDEX\s+ASYNC\b/i.test(out)) {
		out = out.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)(\s+)/i, '$1 ASYNC$2');
	}
	out = out.replace(/\s+/g, ' ').trim();
	const nameMatch = out.match(
		/CREATE\s+(?:UNIQUE\s+)?INDEX\s+ASYNC\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i,
	);
	const asyncIndexName = nameMatch?.[1];
	if (!asyncIndexName) {
		throw new Error(`[dsql-migration] could not extract index name from: ${stmt.slice(0, 120)}…`);
	}
	return { sql: out, asyncIndexName };
}

/**
 * drizzle-kit(pg) generate 出力 SQL を DSQL 用に変換する (純関数・実行なし)。
 *
 * @param sqlText drizzle-kit generate が出力した migration SQL (breakpoint 区切り可)。
 * @returns 適用計画 (ddl 先・dml 後、各文は autocommit で 1 文適用される想定)。
 * @throws SERIAL 検出時 / 非準拠 CREATE SEQUENCE 時 (責務 5)。
 */
export function transformDrizzleSqlToDsql(sqlText: string): DsqlMigrationPlan {
	const statements = splitStatements(sqlText);
	const ddl: DsqlStatement[] = [];
	const dml: DsqlStatement[] = [];

	for (const stmt of statements) {
		// 責務 1: FK 専用 ALTER 文は丸ごと除去。
		if (
			startsWith(stmt, 'ALTER\\s+TABLE') &&
			/\bADD\s+CONSTRAINT\b/i.test(stmt) &&
			/\bFOREIGN\s+KEY\b/i.test(stmt)
		) {
			continue;
		}

		// 責務 6: DML (seed) は別リストへ。
		if (startsWith(stmt, 'INSERT') || startsWith(stmt, 'UPDATE') || startsWith(stmt, 'DELETE')) {
			dml.push({ sql: stmt });
			continue;
		}

		// 責務 2: index は ASYNC 化。
		if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(stmt.trimStart())) {
			ddl.push(transformIndex(stmt));
			continue;
		}

		// 責務 5: SEQUENCE は CACHE 準拠を検証。
		if (startsWith(stmt, 'CREATE\\s+SEQUENCE')) {
			assertSequenceCacheCompliant(stmt);
			ddl.push({ sql: stmt });
			continue;
		}

		// 責務 5 + 1: CREATE TABLE は SERIAL 拒否 + inline/表レベル FK 除去。
		if (startsWith(stmt, 'CREATE\\s+TABLE')) {
			assertNoSerial(stmt);
			ddl.push({ sql: stripForeignKeys(stmt) });
			continue;
		}

		// その他 DDL (CREATE TYPE / ALTER TABLE ADD COLUMN 等) はそのまま DDL として保持。
		ddl.push({ sql: stmt });
	}

	return { ddl, dml };
}
