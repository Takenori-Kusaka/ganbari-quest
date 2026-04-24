#!/usr/bin/env node
/**
 * check-hardcoded-strings.mjs — Issue #1452 Phase A
 *
 * Runs ESLint with the no-hardcoded-jp-text rule and compares the warning count
 * against the stored baseline. Fails if the count has increased.
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

const eslintBin = join(root, 'node_modules', '.bin', 'eslint');

let output = '';
try {
	output = execSync(`"${eslintBin}" --format json "src/routes/**/*.svelte"`, {
		encoding: 'utf-8',
		cwd: root,
		maxBuffer: 64 * 1024 * 1024,
	});
} catch (e) {
	const stdout = e.stdout;
	output = typeof stdout === 'string' ? stdout : (stdout ? stdout.toString('utf-8') : '');
}

let results;
try {
	results = JSON.parse(output);
} catch {
	console.error('Failed to parse ESLint JSON output.');
	process.exit(1);
}

let count = 0;
for (const file of results) {
	for (const msg of file.messages) {
		if (msg.ruleId === rule) {
			count++;
		}
	}
}

console.log(`Hardcoded JP text violations: ${count} (baseline: ${baselineCount})`);

if (count > baselineCount) {
	console.error(
		`\nERROR: Hardcoded JP text count increased by ${count - baselineCount} since baseline.`,
	);
	console.error('Use constants from $lib/domain/labels.ts instead of inline Japanese text.');
	console.error('Update scripts/hardcoded-strings-baseline.json only when REDUCING the count.');
	process.exit(1);
}

if (count < baselineCount) {
	console.log(`\nGreat! Count reduced by ${baselineCount - count}. Consider updating the baseline.`);
}

console.log('OK: Hardcoded JP text count is within baseline.');
