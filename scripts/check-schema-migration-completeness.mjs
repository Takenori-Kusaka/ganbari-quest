#!/usr/bin/env node
/**
 * #2520 AC6/AC7 / #2507 予告実装の最小版 — schema 破壊的変更時の lazy migration 同期 blocker
 *
 * 背景 (#2508 / #2510):
 *   PR #2480 で `checklist_templates` を per-child (child_id NOT NULL) → family master
 *   (tenant_id NOT NULL) に flip した際、schema.ts / create-tables.ts は同期したが
 *   既存 production DB を upgrade する `lazy-startup-migrations.ts` への追加が漏れ、
 *   NUC 起動が `no such column: tenant_id` で block した (NUC down ~6 分)。
 *
 * 本 gate:
 *   `src/lib/server/db/schema.ts` の diff が **NUC 起動 block 級の変更**
 *   を含むときだけ、既存 production DB を upgrade する経路に同期 diff があるかを検証する。
 *   無ければ exit 1 (blocker)。
 *
 *   検出する変更 (`schema-validator.ts` / `client.ts` が exit 1 する境界と一致):
 *     (1) DROP COLUMN
 *     (2) FK target 変更
 *     (3) NOT NULL 追加・削除 (既存列の反転)
 *     (4) cross-table flip (child_id ⇔ tenant_id)
 *     (5) 新規 table 追加 + create-tables.ts / lazy-startup-migrations.ts 同期漏れ (#2827)
 *         — `schema-validator.ts:181-188` の missing table → valid=false → client.ts exit 1
 *     (6) 新規 NOT NULL かつ DEFAULT なし列の追加 (#2827)
 *         — `validateAndMigrate:195-243` の notNull && !hasDefault 列は自動 ALTER 不能 → exit 1
 *
 *   (1)-(4) は lazy-startup-migrations.ts への同期 diff で blocker 解除。
 *   (5) は新規 table 名が create-tables.ts または lazy-startup-migrations.ts の同 PR diff に
 *   出現すれば解除 (#2827)。
 *   (6) は新規列に DEFAULT を付与する (= schema.ts の修正) ことで解除する境界違反のため、
 *   blocker を立てた時点で schema 側の是正を促す。
 *
 *   通常の **非破壊 ADD COLUMN** (nullable / DEFAULT 付き列追加のみ) は `validateAndMigrate`
 *   が自動適用するため warn 止まり (既存 `check-schema-change-tests.mjs` の責務、本 script は exit 0)。
 *
 *   完全な SQL parser は不要 (AC7)。正規表現で破壊的キーワード / 新規 table / 新規列を検出する。
 *
 * #2507 / #2519 との棲み分け:
 *   - #2507  = 3 dimension (schema / create-tables / lazy) 完全同期 gate (将来の full 版)
 *   - 本 script = 破壊的変更時のみ lazy 同期を blocker 化する最小版 (#2507 の予告実装)
 *   - #2519  = runtime data orphan gate (data 側、startup assert)。本 script は static schema diff (PR 時の CI)。file も別。
 *
 * 使い方 (CI):
 *   PR_BODY="$(gh pr view <n> --json body -q .body)" \
 *     node scripts/check-schema-migration-completeness.mjs
 *
 * 使い方 (ローカル検証):
 *   node scripts/check-schema-migration-completeness.mjs
 *   node scripts/check-schema-migration-completeness.mjs --base=HEAD~1
 *
 * 環境変数:
 *   PR_BODY    PR 本文。`[skip-schema-migration-check]` を含めば skip
 *   BASE_REF   diff のベース ref (デフォルト: origin/main)
 *
 * exit:
 *   0 = OK (破壊的変更なし / 破壊的変更ありだが lazy migration 同期済 / skip marker)
 *   1 = 破壊的変更あり かつ lazy-startup-migrations.ts に diff なし (要修正)
 *   2 = git コマンド失敗等の internal error
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE_REF_DEFAULT = 'origin/main';
const PR_BODY = process.env.PR_BODY || '';
const SKIP_MARKER = '[skip-schema-migration-check]';

const SCHEMA_FILE = 'src/lib/server/db/schema.ts';
const LAZY_MIGRATION_FILE = 'src/lib/server/db/migration/lazy-startup-migrations.ts';
const CREATE_TABLES_FILE = 'src/lib/server/db/create-tables.ts';

let baseRef = process.env.BASE_REF || BASE_REF_DEFAULT;
for (const arg of process.argv.slice(2)) {
	if (arg.startsWith('--base=')) {
		baseRef = arg.slice('--base='.length);
	}
}

/**
 * @param {string[]} args
 * @returns {string}
 */
function runGit(args) {
	try {
		return execFileSync('git', args, { encoding: 'utf8' });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[check-schema-migration-completeness] git command failed:', message);
		process.exit(2);
	}
}

function getChangedFiles() {
	return runGit(['diff', '--name-only', `${baseRef}...HEAD`])
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

function getSchemaDiff() {
	// unified=0 で純粋な ± 行のみ抽出 (context 行のノイズを排除)
	return runGit(['diff', '--unified=0', `${baseRef}...HEAD`, '--', SCHEMA_FILE]);
}

/**
 * 指定ファイルの diff (同 PR の差分全体) を取得する。
 * 検出 (5) の「create-tables.ts / lazy-startup-migrations.ts への対応同期」判定に使う。
 * @param {string} file
 * @returns {string}
 */
function getFileDiff(file) {
	return runGit(['diff', `${baseRef}...HEAD`, '--', file]);
}

/**
 * create-tables.ts / lazy-startup-migrations.ts の同 PR diff から「同期済みと見なせる table 名」を集める。
 * 該当 table 名がどちらかの diff に出現していれば、新規 table 追加の対応がなされたと判定する (#2827 検出 5)。
 * @returns {Set<string>}
 */
function getSyncedTableNames() {
	/** @type {Set<string>} */
	const synced = new Set();
	// table 名は create-tables.ts では `CREATE TABLE IF NOT EXISTS <name>`、
	// lazy-startup-migrations.ts では `tableExists(db, '<name>')` / `CREATE TABLE '<name>'` 等で出現する。
	// いずれも diff テキストに table 名が文字列として現れるため、追加/変更行から
	// 識別子・クォート文字列トークンを広く収集し、後段で「新規 table 名」と突合する。
	for (const file of [CREATE_TABLES_FILE, LAZY_MIGRATION_FILE]) {
		const diff = getFileDiff(file);
		for (const line of diff.split('\n')) {
			if (line.startsWith('---') || line.startsWith('+++')) continue;
			if (!line.startsWith('+') && !line.startsWith('-')) continue;
			// snake_case 識別子 + クォート内文字列の両方をトークンとして拾う
			for (const m of line.matchAll(/['"]?\b([a-z][a-z0-9_]+)\b['"]?/g)) {
				const token = m[1];
				if (token) synced.add(token);
			}
		}
	}
	return synced;
}

/**
 * 追加行 (added) を順に走査し、「新規追加された table 定義ブロック配下の列名 (dbColumn)」を集める。
 * unified=0 diff では table 定義開始 `sqliteTable('<name>', {` と続く列定義行が同じ追加 hunk に
 * 連続して並ぶため、`sqliteTable('<newtable>'` 行以降・table ブロック終端 (`});` / 次の sqliteTable)
 * までの列を新規 table 配下と見なす。検出 (6) で新規 table のカラムを除外するために使う (#2827)。
 *
 * @param {string[]} added         追加行 (先頭の '+' を除去済み)
 * @param {Set<string>} addedTables  追加側に出現した table 名
 * @param {Set<string>} removedTables  削除側に出現した table 名 (rename は新規ではない)
 * @returns {Set<string>}  新規 table 配下に定義された dbColumn の集合
 */
function collectColumnsInAddedTables(added, addedTables, removedTables) {
	const TABLE_START_RE = /sqliteTable\(\s*['"]([\w]+)['"]/;
	const COL_RE = /^\s*(\w+)\s*:\s*(integer|text|real|blob)\s*\(\s*['"]([\w]+)['"]/;
	/** @type {Set<string>} */
	const cols = new Set();
	/** @type {string | null} */
	let currentNewTable = null;
	for (const line of added) {
		const tableStart = line.match(TABLE_START_RE);
		if (tableStart) {
			const name = tableStart[1] ?? '';
			// 真の新規 table (追加側のみ) のときだけ追跡開始。rename / 行移動は対象外。
			currentNewTable =
				name !== '' && addedTables.has(name) && !removedTables.has(name) ? name : null;
			continue;
		}
		// table ブロック終端 (drizzle 定義の閉じ `}` / `});`) で追跡解除
		if (currentNewTable && /^\s*\}/.test(line)) {
			currentNewTable = null;
			continue;
		}
		if (currentNewTable) {
			const col = line.match(COL_RE);
			if (col?.[3]) cols.add(col[3]);
		}
	}
	return cols;
}

/**
 * schema.ts の diff から破壊的変更を検出する。
 * 完全 parser でなく、drizzle column 定義行の正規表現で実用的に判定する (AC7)。
 *
 * @param {string} diff  `git diff --unified=0` の出力
 * @param {{ syncedTableNames?: Set<string> }} [options]
 *   `syncedTableNames`: create-tables.ts / lazy-startup-migrations.ts の同 PR diff に出現した
 *   table 名の集合。検出 (5) の同期判定に使う。未指定なら新規 table は常に未同期扱い (blocker)。
 * @returns {{ reason: string, line: string }[]}  検出された破壊的変更の一覧
 */
export function detectBreakingChanges(diff, options = {}) {
	const syncedTableNames = options.syncedTableNames ?? new Set();
	/** @type {{ reason: string, line: string }[]} */
	const breaking = [];
	const lines = diff.split('\n');

	// 削除行 (-) / 追加行 (+) を収集 (diff header の ---/+++ は除外)
	/** @type {string[]} */
	const removed = [];
	const added = [];
	for (const line of lines) {
		if (line.startsWith('---') || line.startsWith('+++')) continue;
		if (line.startsWith('-')) removed.push(line.slice(1));
		else if (line.startsWith('+')) added.push(line.slice(1));
	}

	const removedText = removed.join('\n');
	const addedText = added.join('\n');

	// drizzle column 定義行から "列名" を抜き出す helper
	//   例 1: `	childId: integer('child_id').notNull().references(() => children.id),`
	//        → fieldName = childId / dbColumn = child_id
	//   例 2 (#2689 fix): `	archivedReason: text('archived_reason', { enum: ARCHIVED_REASONS }),`
	//        → fieldName = archivedReason / dbColumn = archived_reason
	//
	// 旧正規表現 (Phase 7 PR-2a #2689 fix 前) は `\(\s*['"]([\w]+)['"]\s*\)` で **閉じ括弧** を必須として
	// いたため、`text('archived_reason', { enum: ... })` のように追加引数を持つ定義行を全くマッチ
	// できず、列名抽出に失敗 → 「削除側にのみ存在する列」= DROP COLUMN と誤判定していた。
	// 第 2 引数 (drizzle column options) を許容するため、列名直後を「クォート閉じ + 任意の追加引数」に拡張。
	const COLUMN_RE = /^\s*(\w+)\s*:\s*(integer|text|real|blob)\s*\(\s*['"]([\w]+)['"]/;

	/**
	 * @param {string} text
	 * @returns {Map<string, { fieldName: string, line: string }>}
	 */
	function parseColumns(text) {
		/** @type {Map<string, { fieldName: string, line: string }>} */
		const cols = new Map(); // dbColumn -> { fieldName, line }
		for (const l of text.split('\n')) {
			const m = l.match(COLUMN_RE);
			const dbColumn = m?.[3];
			const fieldName = m?.[1];
			if (dbColumn && fieldName) cols.set(dbColumn, { fieldName, line: l.trim() });
		}
		return cols;
	}

	const removedCols = parseColumns(removedText);
	const addedCols = parseColumns(addedText);

	// (1) DROP COLUMN: 削除された列定義のうち、追加側に同名 dbColumn が無い
	for (const [dbCol, info] of removedCols) {
		if (!addedCols.has(dbCol)) {
			breaking.push({ reason: `DROP COLUMN (列 '${dbCol}' が削除された)`, line: info.line });
		}
	}

	// (2) FK target 変更: `.references(() => <table>.<col>)` の <table> が変わった
	//     削除行 / 追加行それぞれの references target を集計し、消えた target を破壊扱い
	const REF_RE = /\.references\(\s*\(\s*\)\s*=>\s*(\w+)\./g;
	const removedRefTargets = new Set();
	const addedRefTargets = new Set();
	for (const m of removedText.matchAll(REF_RE)) removedRefTargets.add(m[1]);
	for (const m of addedText.matchAll(REF_RE)) addedRefTargets.add(m[1]);
	for (const t of removedRefTargets) {
		if (!addedRefTargets.has(t)) {
			breaking.push({
				reason: `FK target 変更 (references → ${t} が削除/付け替えされた)`,
				line: `.references(() => ${t}.…)`,
			});
		}
	}

	// (3) NOT NULL 変更: `.notNull()` の出現が ± で増減した列
	//     削除行に .notNull() があり追加行で同 dbColumn に .notNull() が無い (NOT NULL 撤去) /
	//     その逆 (NOT NULL 付与) の両方を破壊扱い (既存行が制約違反になり得る)。
	/**
	 * @param {Map<string, { fieldName: string, line: string }>} cols
	 * @returns {Set<string>}
	 */
	function notNullColumns(cols) {
		/** @type {Set<string>} */
		const s = new Set();
		for (const [dbCol, info] of cols) {
			if (/\.notNull\(\)/.test(info.line)) s.add(dbCol);
		}
		return s;
	}
	const removedNotNull = notNullColumns(removedCols);
	const addedNotNull = notNullColumns(addedCols);
	// 両方に存在する列で notNull の有無が反転したものを検出
	for (const [dbCol] of removedCols) {
		if (!addedCols.has(dbCol)) continue; // DROP は (1) で検出済
		const before = removedNotNull.has(dbCol);
		const after = addedNotNull.has(dbCol);
		if (before !== after) {
			breaking.push({
				reason: `NOT NULL 変更 (列 '${dbCol}': notNull ${before ? 'あり→なし' : 'なし→あり'})`,
				line: dbCol,
			});
		}
	}

	// (4) cross-table flip: 同一 PR で child_id 系列と tenant_id 系列が ± で入れ替わった
	//     (#2480 checklist_templates flip の signature)。
	const removedHasChildId = removedRefTargets.has('children') || removedCols.has('child_id');
	const addedHasTenantId = /tenant_id/.test(addedText) && !/tenant_id/.test(removedText);
	const removedHasTenantId = /tenant_id/.test(removedText) && !/tenant_id/.test(addedText);
	const addedHasChildId = addedRefTargets.has('children') || addedCols.has('child_id');
	if ((removedHasChildId && addedHasTenantId) || (removedHasTenantId && addedHasChildId)) {
		breaking.push({
			reason: 'cross-table flip (child_id ⇔ tenant_id の aggregate root 切替、#2480 型)',
			line: 'child_id / tenant_id 列の入替',
		});
	}

	// (5) 新規 table 追加 + create-tables.ts / lazy-startup-migrations.ts 同期漏れ (#2827)
	//     schema.ts diff に `sqliteTable('<name>', ...)` が **追加された** が、
	//     削除側に同名 table が無い (= 真の新規 table) ものを抽出する。
	//     根拠: schema-validator.ts:181-188 が missing table を valid=false → client.ts exit 1
	//     (= NUC 起動停止)。新規 table 名が create-tables.ts / lazy-startup-migrations.ts の
	//     同 PR diff に出現していなければ、新規 DB / 既存 DB 両方で table が作られず起動 block。
	const TABLE_RE = /sqliteTable\(\s*['"]([\w]+)['"]/g;
	/** @type {Set<string>} */
	const removedTables = new Set();
	for (const m of removedText.matchAll(TABLE_RE)) {
		if (m[1]) removedTables.add(m[1]);
	}
	/** @type {Set<string>} */
	const addedTables = new Set();
	for (const m of addedText.matchAll(TABLE_RE)) {
		if (m[1]) addedTables.add(m[1]);
	}
	for (const tableName of addedTables) {
		if (removedTables.has(tableName)) continue; // rename / 行移動は新規ではない
		if (syncedTableNames.has(tableName)) continue; // create-tables / lazy に同期済
		breaking.push({
			reason: `新規 table 追加 (table '${tableName}' が schema.ts に追加されたが create-tables.ts / lazy-startup-migrations.ts に未同期)`,
			line: `sqliteTable('${tableName}', …)`,
		});
	}

	// (6) 新規 NOT NULL かつ DEFAULT なし列の追加 (#2827)
	//     既存 table に追加された新規列が notNull かつ .default() なしのケースを検出する。
	//     根拠: validateAndMigrate:195-243 は notNull && !hasDefault の不足列を自動 ALTER 不能とし
	//     valid=false → client.ts exit 1 (= NUC 起動停止、手動マイグレーション必須)。
	//
	//     除外条件:
	//       - removedCols に同名 dbColumn がある列 = 既存列の反転 → (3) の責務
	//       - 新規 table 配下の列 = その table は CREATE TABLE で丸ごと作られるため、
	//         ALTER ADD COLUMN 経路に乗らず exit 1 にならない (missing-table 判定が先行)。
	//         → 新規 table のカラムは (6) の対象外。
	const dbColsInNewTables = collectColumnsInAddedTables(added, addedTables, removedTables);
	for (const [dbCol, info] of addedCols) {
		if (removedCols.has(dbCol)) continue; // 既存列の変更は (3) の責務
		if (dbColsInNewTables.has(dbCol)) continue; // 新規 table 配下の列は CREATE TABLE 経路
		const isNotNull = /\.notNull\(\)/.test(info.line);
		const hasDefault = /\.default\(/.test(info.line);
		if (isNotNull && !hasDefault) {
			breaking.push({
				reason: `新規 NOT NULL no-default 列追加 (列 '${dbCol}': notNull かつ DEFAULT なし → 既存 DB で自動 ALTER 不能)`,
				line: info.line,
			});
		}
	}

	return breaking;
}

function main() {
	if (PR_BODY.includes(SKIP_MARKER)) {
		console.log(`[check-schema-migration-completeness] ${SKIP_MARKER} marker found — skipping.`);
		return;
	}

	const changed = getChangedFiles();
	if (!changed.includes(SCHEMA_FILE)) {
		console.log('[check-schema-migration-completeness] schema.ts not changed — no check needed.');
		return;
	}

	const diff = getSchemaDiff();
	// 検出 (5): create-tables.ts / lazy-startup-migrations.ts の同 PR diff から
	// 「同期済みと見なせる table 名」を集めて新規 table の同期判定に使う。
	const syncedTableNames = getSyncedTableNames();
	const breaking = detectBreakingChanges(diff, { syncedTableNames });

	if (breaking.length === 0) {
		console.log(
			'[check-schema-migration-completeness] schema.ts changed but no breaking change detected (非破壊 ADD COLUMN 等は warn 対象、本 gate は OK).',
		);
		return;
	}

	const lazyChanged = changed.includes(LAZY_MIGRATION_FILE);

	// 検出 (6) 新規 NOT NULL no-default 列は、lazy-startup-migrations.ts を触っても解決しない
	// (schema.ts 側で DEFAULT 付与 / nullable 化が必要)。lazyChanged では bypass させない。
	const schemaFixRequired = breaking.filter((b) =>
		b.reason.includes('新規 NOT NULL no-default 列追加'),
	);

	console.log('');
	console.log('[check-schema-migration-completeness] NUC 起動 block 級の schema 変更を検出:');
	for (const b of breaking) {
		console.log(`  - ${b.reason}`);
		console.log(`      ${b.line}`);
	}
	console.log('');

	if (schemaFixRequired.length > 0) {
		console.error(
			'❌ [check-schema-migration-completeness] BLOCKER (検出 6: 新規 NOT NULL no-default 列)',
		);
		console.error('');
		console.error('  追加された NOT NULL かつ DEFAULT なしの列は、既存 production DB に対し');
		console.error('  `validateAndMigrate` (schema-validator.ts:195-243) が自動 ALTER できず');
		console.error('  valid=false → client.ts で exit 1 (NUC 起動停止) を引き起こします。');
		console.error('');
		console.error('  schema.ts 側で当該列に `.default(...)` を付与するか nullable 化してください');
		console.error('  (lazy-startup-migrations.ts への追加では解決しません)。');
		console.error('');
		console.error(
			'  参照: docs/design/08-データベース設計書.md §1 lazy migration 必須 SSOT / Issue #2827',
		);
		console.error('');
		process.exit(1);
	}

	if (lazyChanged) {
		console.log(
			`✅ OK — ${LAZY_MIGRATION_FILE} に同期 diff あり (既存 DB upgrade 経路が更新されている).`,
		);
		return;
	}

	console.error('❌ [check-schema-migration-completeness] BLOCKER');
	console.error('');
	console.error(
		'  NUC 起動 block 級の schema 変更 (DROP COLUMN / FK target 変更 / NOT NULL 変更 /',
	);
	console.error(
		'  cross-table flip / 新規 table 追加) を含むのに、既存 production DB を upgrade する',
	);
	console.error(`  ${LAZY_MIGRATION_FILE} に diff がありません。`);
	console.error('');
	console.error(
		'  #2508 (NUC startup failure 2026-05-27) と同じ「既存 DB を新 schema に上げられず',
	);
	console.error('  起動 block」を再発させます。lazy-startup-migrations.ts に shadow-table');
	console.error('  recreation / ALTER 等の upgrade step を追加してください。');
	console.error('  新規 table 追加の場合は create-tables.ts への CREATE TABLE 追加も必須です。');
	console.error('');
	console.error(
		`  純フォーマット変更など意図的に skip する場合は PR 本文に "${SKIP_MARKER}" を含めてください。`,
	);
	console.error('');
	console.error(
		'  参照: docs/design/08-データベース設計書.md §1 lazy migration 必須 SSOT / Issue #2507 / #2508 / #2827',
	);
	console.error('');
	process.exit(1);
}

// CLI として直接実行された場合のみ main() を起動 (test からの import 時は実行しない)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main();
}
