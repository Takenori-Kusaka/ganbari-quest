#!/usr/bin/env node
/**
 * check-hardcoded-strings.mjs — Issue #1452 Phase A / #1465 Phase A
 *
 * ESLint (no-hardcoded-jp-text) で src/**​/*.svelte を検査する。
 * baseline より増加した場合は exit 1。
 *
 * HTML チェックは scripts/check-lp-ssot.mjs が担当。
 *
 * Usage: node scripts/check-hardcoded-strings.mjs
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const baselineFile = join(__dirname, 'hardcoded-strings-baseline.json');

const baseline = JSON.parse(readFileSync(baselineFile, 'utf-8'));
const { count: baselineCount, rule } = baseline;

// =====================================================================
// Svelte チェック (ESLint)
// =====================================================================

const eslintBin = join(root, 'node_modules', '.bin', 'eslint');

let eslintOutput = '';
try {
	eslintOutput = execSync(`"${eslintBin}" --format json "src/**/*.svelte"`, {
		encoding: 'utf-8',
		cwd: root,
		maxBuffer: 64 * 1024 * 1024,
	});
} catch (e) {
	const stdout = e.stdout;
	eslintOutput = typeof stdout === 'string' ? stdout : stdout ? stdout.toString('utf-8') : '';
}

let eslintResults;
try {
	eslintResults = JSON.parse(eslintOutput);
} catch {
	console.error('Failed to parse ESLint JSON output.');
	process.exit(1);
}

let svelteCount = 0;
for (const file of eslintResults) {
	for (const msg of file.messages) {
		if (msg.ruleId === rule) {
			svelteCount++;
		}
	}
}

// =====================================================================
// 結果表示とゲート判定
// =====================================================================

console.log(`[Svelte] Hardcoded JP text violations: ${svelteCount} (baseline: ${baselineCount})`);

if (svelteCount > baselineCount) {
	console.error(
		`\nERROR [Svelte]: Hardcoded JP text count increased by ${svelteCount - baselineCount} since baseline.`,
	);
	console.error('Use constants from $lib/domain/labels.ts instead of inline Japanese text.');
	console.error('Update scripts/hardcoded-strings-baseline.json only when REDUCING the count.');
	process.exit(1);
}

if (svelteCount < baselineCount) {
	console.log(
		`\n[Svelte] Great! Count reduced by ${baselineCount - svelteCount}. Consider updating the baseline.`,
	);
}

console.log('OK: Hardcoded JP text counts are within baseline.');
