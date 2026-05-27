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
 * 本 gate (最小版):
 *   `src/lib/server/db/schema.ts` の diff が **破壊的変更**
 *   (DROP COLUMN / FK target 変更 / NOT NULL 追加・削除 / cross-table flip) を含むときだけ、
 *   `src/lib/server/db/migration/lazy-startup-migrations.ts` に diff があるかを検証する。
 *   無ければ exit 1 (blocker)。
 *
 *   通常の **ADD COLUMN** (列追加のみ) は破壊的でないため warn 止まり (既存
 *   `check-schema-change-tests.mjs` の責務、本 script は exit 0)。
 *
 *   完全な SQL parser は不要 (AC7)。正規表現で破壊的キーワードを検出し、該当時に
 *   lazy-startup-migrations.ts 差分の有無を確認する、で十分。
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
 * schema.ts の diff から破壊的変更を検出する。
 * 完全 parser でなく、drizzle column 定義行の正規表現で実用的に判定する (AC7)。
 *
 * @param {string} diff  `git diff --unified=0` の出力
 * @returns {{ reason: string, line: string }[]}  検出された破壊的変更の一覧
 */
export function detectBreakingChanges(diff) {
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
	//   例: `	childId: integer('child_id').notNull().references(() => children.id),`
	//   → fieldName = childId / dbColumn = child_id
	const COLUMN_RE = /^\s*(\w+)\s*:\s*(integer|text|real|blob)\s*\(\s*['"]([\w]+)['"]\s*\)/;

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
	const breaking = detectBreakingChanges(diff);

	if (breaking.length === 0) {
		console.log(
			'[check-schema-migration-completeness] schema.ts changed but no breaking change detected (ADD COLUMN 等は warn 対象、本 gate は OK).',
		);
		return;
	}

	const lazyChanged = changed.includes(LAZY_MIGRATION_FILE);

	console.log('');
	console.log('[check-schema-migration-completeness] 破壊的 schema 変更を検出:');
	for (const b of breaking) {
		console.log(`  - ${b.reason}`);
		console.log(`      ${b.line}`);
	}
	console.log('');

	if (lazyChanged) {
		console.log(
			`✅ OK — ${LAZY_MIGRATION_FILE} に同期 diff あり (既存 DB upgrade 経路が更新されている).`,
		);
		return;
	}

	console.error('❌ [check-schema-migration-completeness] BLOCKER');
	console.error('');
	console.error(
		'  破壊的 schema 変更 (DROP COLUMN / FK target 変更 / NOT NULL 変更 / cross-table flip) を',
	);
	console.error('  含むのに、既存 production DB を upgrade する');
	console.error(`  ${LAZY_MIGRATION_FILE} に diff がありません。`);
	console.error('');
	console.error(
		'  #2508 (NUC startup failure 2026-05-27) と同じ「既存 DB を新 schema に上げられず',
	);
	console.error('  起動 block」を再発させます。lazy-startup-migrations.ts に shadow-table');
	console.error('  recreation / ALTER 等の upgrade step を追加してください。');
	console.error('');
	console.error(
		`  純フォーマット変更など意図的に skip する場合は PR 本文に "${SKIP_MARKER}" を含めてください。`,
	);
	console.error('');
	console.error('  参照: docs/design/08-データベース設計書.md §8.6 / Issue #2507 / #2508');
	console.error('');
	process.exit(1);
}

// CLI として直接実行された場合のみ main() を起動 (test からの import 時は実行しない)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main();
}
