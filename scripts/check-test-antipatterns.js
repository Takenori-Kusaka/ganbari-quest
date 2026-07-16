#!/usr/bin/env node
/**
 * CI test anti-pattern detector.
 *
 * Checks for patterns that degrade test quality:
 * 1. New usage of clearDialogGhosts outside helpers.ts
 * 2. test.skip / test.fixme count increase vs origin/main
 *
 * Usage:
 *   node scripts/check-test-antipatterns.js
 *
 * Exit codes:
 *   0 = passed (warnings may be printed)
 *   1 = blocking anti-pattern detected
 */

import { execSync } from 'node:child_process';

let hasError = false;

const TEST_SKIP_PATTERN = 'test\\.skip\\|test\\.fixme\\|it\\.skip\\|describe\\.skip';

// #3352: 明示 escape hatch。環境 capability 由来の「条件付き skip + reason」(Playwright 公式
// pattern) を honest SKIPPED 計上へ是正する際、同一行に `// ratchet-allow: #<issue>` を付けた
// 行のみ ratchet 集計から除外する (eslint-disable-line と同型の可視・監査可能な annotation)。
// - default 挙動は不変: marker なしの test.skip/fixme 増加は従来どおり BLOCK
// - marker には Issue 番号必須 (根拠 traceability)。check-skip-deadlines.mjs の metadata gate
//   (ADR-0006) も全 skip に引き続き適用される (二重ガード)
// - 背景: 本 ratchet が count-only だったため「return-skip で PASSED 偽装」という より悪い
//   anti-pattern を誘発していた (#3352 (B) Goodhart hazard)。honest skip を可視 annotation 付きで
//   許容し、偽装 skip への逃げ道を断つ
const RATCHET_ALLOW_RE = /\/\/\s*ratchet-allow:\s*#\d+/;

function countSkipLines(gitGrepRef) {
	// gitGrepRef: '' = working tree / 'origin/main' = main 側。同一ロジックで両側を数える。
	const cmd = gitGrepRef
		? `git grep -n "${TEST_SKIP_PATTERN}" ${gitGrepRef} -- "tests/e2e/" || true`
		: `git grep -n "${TEST_SKIP_PATTERN}" -- "tests/e2e/" || true`;
	const output = execSync(cmd, { encoding: 'utf-8' });
	return output
		.trim()
		.split('\n')
		.filter(Boolean)
		.filter((line) => !RATCHET_ALLOW_RE.test(line)).length;
}

// --- 1. Check for new clearDialogGhosts usage in diff ---
try {
	const diffFiles = execSync('git diff origin/main --name-only -- tests/', { encoding: 'utf-8' });
	const changedTestFiles = diffFiles.trim().split('\n').filter(Boolean);
	const newGhostCallFiles = [];

	for (const file of changedTestFiles) {
		if (file === 'tests/e2e/helpers.ts') continue;
		try {
			const fileDiff = execSync(`git diff origin/main -- "${file}"`, { encoding: 'utf-8' });
			const addedLines = fileDiff
				.split('\n')
				.filter(
					(l) => l.startsWith('+') && !l.startsWith('+++') && l.includes('clearDialogGhosts'),
				);
			if (addedLines.length > 0) {
				newGhostCallFiles.push(file);
			}
		} catch {
			// file might not exist on main
		}
	}

	if (newGhostCallFiles.length > 0) {
		console.error('BLOCKED: New clearDialogGhosts usage detected in:');
		for (const f of newGhostCallFiles) {
			console.error(`  - ${f}`);
		}
		console.error(
			'clearDialogGhosts masks Ark UI Dialog bugs. Fix the root cause instead.\n' +
				'See #678: テスト品質劣化の根本対策',
		);
		hasError = true;
	} else {
		console.log('  clearDialogGhosts: no new usage outside helpers.ts');
	}
} catch {
	console.log('  clearDialogGhosts check: skipped (no git diff available)');
}

// --- 2. Count test.skip / test.fixme and compare vs origin/main ---
// #3352: ratchet-allow annotation 付き行 (条件付き環境 skip の明示許容) は両側とも除外して比較する。
try {
	const totalSkips = countSkipLines('');

	console.log(`  test.skip/fixme count in e2e (ratchet-allow 除外後): ${totalSkips}`);

	// Compare vs origin/main without mutating the working tree
	try {
		const mainTotalSkips = countSkipLines('origin/main');

		console.log(
			`  test.skip/fixme count in origin/main e2e (ratchet-allow 除外後): ${mainTotalSkips}`,
		);

		if (totalSkips > mainTotalSkips) {
			console.error(
				`BLOCKED: test.skip/fixme count increased in e2e (${mainTotalSkips} -> ${totalSkips}).\n` +
					'条件付き環境 skip (Playwright 公式 pattern) として正当な場合のみ、同一行に\n' +
					'`// ratchet-allow: #<issue>` annotation を付与して除外できる (#3352)。\n' +
					'無条件 skip / fixme でテストを黙らせる用途への annotation 濫用は QM レビューで BLOCK 対象。',
			);
			hasError = true;
		} else {
			console.log('  test.skip/fixme: no increase vs origin/main');
		}
	} catch {
		console.log('  test.skip/fixme comparison: skipped (origin/main not available)');
	}
} catch {
	console.log('  test.skip count: check skipped');
}

// --- 3. Summary ---
if (hasError) {
	console.error('\nTest anti-pattern check FAILED.');
	process.exit(1);
}

console.log('\nTest anti-pattern check passed.');
