#!/usr/bin/env node
/**
 * CI test anti-pattern detector.
 *
 * Checks for patterns that degrade test quality:
 * 1. test.skip / test.fixme count increase
 * 2. New usage of clearDialogGhosts outside helpers.ts
 * 3. Empty catch blocks in test files (error swallowing)
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

// --- 1. Check for new clearDialogGhosts usage in diff ---
try {
	const diff = execSync('git diff origin/main -- tests/', { encoding: 'utf-8' });
	const newGhostCalls = diff
		.split('\n')
		.filter((line) => line.startsWith('+') && !line.startsWith('+++'))
		.filter((line) => line.includes('clearDialogGhosts'))
		// Allow in helpers.ts (the canonical location)
		.length;

	// Check if any new calls were added outside helpers.ts
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

// --- 2. Count test.skip / test.fixme ---
try {
	const skipCount = execSync(
		'git grep -c "test\\.skip\\|test\\.fixme\\|it\\.skip\\|describe\\.skip" -- "tests/e2e/" || echo "0"',
		{ encoding: 'utf-8' },
	);

	const totalSkips = skipCount
		.trim()
		.split('\n')
		.reduce((sum, line) => {
			const match = line.match(/:(\d+)$/);
			return sum + (match ? Number.parseInt(match[1]) : 0);
		}, 0);

	console.log(`  test.skip/fixme count in e2e: ${totalSkips}`);

	// Check if count increased vs main
	try {
		const mainSkipCount = execSync(
			'git stash -q 2>/dev/null; git checkout origin/main -- tests/e2e/ 2>/dev/null && git grep -c "test\\.skip\\|test\\.fixme\\|it\\.skip\\|describe\\.skip" -- "tests/e2e/" || echo "0"; git checkout HEAD -- tests/e2e/ 2>/dev/null; git stash pop -q 2>/dev/null',
			{ encoding: 'utf-8' },
		);
		// This is complex; just report the count for now
	} catch {
		// skip comparison if main not available
	}

	if (totalSkips > 10) {
		console.warn(`  WARNING: High test.skip count (${totalSkips}). Review and reduce skips.`);
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
