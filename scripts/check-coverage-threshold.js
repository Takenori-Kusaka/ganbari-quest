#!/usr/bin/env node
/**
 * CI coverage threshold ratchet checker.
 *
 * Compares the coverage thresholds in vite.config.ts between the PR branch
 * and origin/main. If any threshold has been decreased, the script exits
 * with code 1 (failing the CI step).
 *
 * Usage:
 *   node scripts/check-coverage-threshold.js
 *
 * Environment:
 *   Requires git access. Reads vite.config.ts from both HEAD and origin/main.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const THRESHOLD_KEYS = ['lines', 'functions', 'branches', 'statements'];

/**
 * Extract threshold values from vite.config.ts content using regex.
 * This avoids eval/import of the config which requires all deps.
 */
function extractThresholds(content) {
	const thresholds = {};
	const blockMatch = content.match(/thresholds:\s*\{([^}]+)\}/);
	if (!blockMatch) return null;
	const block = blockMatch[1];

	for (const key of THRESHOLD_KEYS) {
		const match = block.match(new RegExp(`${key}:\\s*(\\d+(?:\\.\\d+)?)`));
		if (match) {
			thresholds[key] = Number.parseFloat(match[1]);
		}
	}
	return thresholds;
}

// Read current (PR branch) vite.config.ts
const currentContent = fs.readFileSync('vite.config.ts', 'utf-8');
const current = extractThresholds(currentContent);

if (!current) {
	console.log('No coverage thresholds found in vite.config.ts — skipping check');
	process.exit(0);
}

// Read base (origin/main) vite.config.ts
let baseContent;
try {
	baseContent = execSync('git show origin/main:vite.config.ts', { encoding: 'utf-8' });
} catch {
	console.log('Could not read origin/main:vite.config.ts — skipping check (new repo or no remote)');
	process.exit(0);
}

const base = extractThresholds(baseContent);
if (!base) {
	console.log('No coverage thresholds found in origin/main:vite.config.ts — skipping check');
	process.exit(0);
}

// Compare
let hasDecrease = false;
for (const key of THRESHOLD_KEYS) {
	const baseVal = base[key] ?? 0;
	const currentVal = current[key] ?? 0;

	if (currentVal < baseVal) {
		console.error(`BLOCKED: coverage threshold "${key}" decreased: ${baseVal} → ${currentVal}`);
		hasDecrease = true;
	} else if (currentVal > baseVal) {
		console.log(`  ${key}: ${baseVal} → ${currentVal} (increased)`);
	} else {
		console.log(`  ${key}: ${currentVal} (unchanged)`);
	}
}

if (hasDecrease) {
	console.error(
		'\nCoverage threshold decrease detected. This is not allowed.\n' +
			'If you need to lower thresholds, create an issue explaining why.\n' +
			'See ADR-0012: テスト品質の劣化を許容しない開発プロセス',
	);
	process.exit(1);
}

console.log('\nCoverage threshold ratchet check passed.');
