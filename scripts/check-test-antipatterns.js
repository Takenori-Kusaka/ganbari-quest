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

function sumGitGrepCountOutput(output) {
	return output
		.trim()
		.split('\n')
		.filter(Boolean)
		.reduce((sum, line) => {
			const match = line.match(/:(\d+)$/);
			return sum + (match ? Number.parseInt(match[1], 10) : 0);
		}, 0);
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
				.filter((l) => l.startsWith('+') && !l.startsWith('+++') && l.includes('clearDialogGhosts'));
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
try {
	const skipCount = execSync(
		`git grep -c "${TEST_SKIP_PATTERN}" -- "tests/e2e/" || echo "0"`,
		{ encoding: 'utf-8' },
	);

	const totalSkips = sumGitGrepCountOutput(skipCount);

	console.log(`  test.skip/fixme count in e2e: ${totalSkips}`);

	// Compare vs origin/main without mutating the working tree
	try {
		const mainSkipCount = execSync(
			`git grep -c "${TEST_SKIP_PATTERN}" origin/main -- "tests/e2e/" || echo "0"`,
			{ encoding: 'utf-8' },
		);
		const mainTotalSkips = sumGitGrepCountOutput(mainSkipCount);

		console.log(`  test.skip/fixme count in origin/main e2e: ${mainTotalSkips}`);

		if (totalSkips > mainTotalSkips) {
			console.error(
				`BLOCKED: test.skip/fixme count increased in e2e (${mainTotalSkips} -> ${totalSkips}).`,
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
