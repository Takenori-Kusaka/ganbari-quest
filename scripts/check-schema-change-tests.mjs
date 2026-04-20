#!/usr/bin/env node
/**
 * #963 / ADR-0031 — スキーマ変更時のテスト追加チェック
 *
 * PR diff に `src/lib/server/db/schema.ts` が含まれるのに、
 * `tests/unit/db/` または `tests/unit/services/` にテスト追加/変更が無い場合に warn を出す。
 *
 * warn 止まり（exit 0）で blocker にはしないが、PR レビュー側で `[must]` 指摘の判断材料に使う。
 * 純フォーマット変更等で意図的に skip したい場合は PR 本文に `[skip-schema-test-check]` を含める。
 *
 * 使い方 (CI):
 *   PR_BODY="$(gh pr view ${{ github.event.number }} --json body -q .body)" \
 *     node scripts/check-schema-change-tests.mjs
 *
 * 使い方 (ローカル検証):
 *   node scripts/check-schema-change-tests.mjs
 *   node scripts/check-schema-change-tests.mjs --base=HEAD~1
 *
 * 環境変数:
 *   PR_BODY    PR 本文。`[skip-schema-test-check]` を含めば skip
 *   BASE_REF   diff のベース ref (デフォルト: origin/main)
 *
 * exit:
 *   0 = 常に 0 (warn のみ)
 *   2 = git コマンド失敗等の internal error
 */

import { execFileSync } from 'node:child_process';

const BASE_REF_DEFAULT = 'origin/main';
const PR_BODY = process.env.PR_BODY || '';
const SKIP_MARKER = '[skip-schema-test-check]';

const SCHEMA_FILE = 'src/lib/server/db/schema.ts';
const TEST_DIR_PREFIXES = ['tests/unit/db/', 'tests/unit/services/'];

// CLI args
let baseRef = process.env.BASE_REF || BASE_REF_DEFAULT;
for (const arg of process.argv.slice(2)) {
	if (arg.startsWith('--base=')) {
		baseRef = arg.slice('--base='.length);
	}
}

function runGit(args) {
	try {
		return execFileSync('git', args, { encoding: 'utf8' });
	} catch (err) {
		console.error('[check-schema-change-tests] git command failed:', err.message);
		process.exit(2);
	}
}

function getChangedFiles() {
	const output = runGit(['diff', '--name-only', `${baseRef}...HEAD`]);
	return output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function main() {
	if (PR_BODY.includes(SKIP_MARKER)) {
		console.log(`[check-schema-change-tests] ${SKIP_MARKER} marker found — skipping.`);
		return;
	}

	const changed = getChangedFiles();
	const schemaChanged = changed.includes(SCHEMA_FILE);

	if (!schemaChanged) {
		console.log('[check-schema-change-tests] schema.ts not changed — no check needed.');
		return;
	}

	const testChanges = changed.filter((file) =>
		TEST_DIR_PREFIXES.some((prefix) => file.startsWith(prefix)),
	);

	if (testChanges.length > 0) {
		console.log(
			`[check-schema-change-tests] OK — schema.ts changed and ${testChanges.length} test file(s) updated:`,
		);
		for (const file of testChanges) {
			console.log(`  - ${file}`);
		}
		return;
	}

	console.warn('');
	console.warn('⚠️  [check-schema-change-tests] WARNING');
	console.warn('⚠️  src/lib/server/db/schema.ts was modified, but no test files under');
	console.warn('⚠️  tests/unit/db/ or tests/unit/services/ were added or changed.');
	console.warn('');
	console.warn('⚠️  ADR-0031 requires schema changes to include tests that cover');
	console.warn('⚠️  NULL-containing legacy rows (e.g. rows that existed before a new');
	console.warn('⚠️  column was added via ALTER TABLE ADD COLUMN).');
	console.warn('');
	console.warn('⚠️  If this PR is a pure format/comment change, add');
	console.warn(`⚠️  "${SKIP_MARKER}" to the PR body to silence this warning.`);
	console.warn('');
	console.warn('⚠️  Reference: docs/decisions/archive/0031-schema-change-compat-testing.md');
	console.warn('');
}

main();
