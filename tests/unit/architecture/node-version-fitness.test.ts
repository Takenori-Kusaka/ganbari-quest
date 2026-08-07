// Issue #4199 — Fitness function to enforce that all Node.js version declarations
// (.nvmrc, package.json engines, Dockerfiles, and CDK Lambda runtimes) are aligned with the same major version.
//
// Background:
//   Lack of centralized version declarations caused differences between local development and CI major versions.
//   This fitness function ensures that Node.js 22 is pinned across all environments and that any future changes
//   to .nvmrc must be reflected everywhere, preventing silent drift (ADR-0061, 1-in-1-out ratchet rule).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(...segments: string[]): string {
	return readFileSync(join(ROOT, ...segments), 'utf-8');
}

describe('Node.js Version Alignment Fitness Function (Issue #4199)', () => {
	// 1. Resolve .nvmrc to get the single source of truth (SSOT) major version
	const nvmrc = read('.nvmrc').trim();
	const majorVersion = nvmrc.split('.')[0]; // e.g. "22"

	it('.nvmrc major version matches package.json engines and packageManager', () => {
		const pkg = JSON.parse(read('package.json'));
		const nodeEngine = pkg.engines?.node;
		expect(nodeEngine, 'package.json engines must define Node.js constraint').toBeDefined();
		// engines.node should contain the major version, e.g., ">=22.22.2 <23" or similar
		expect(nodeEngine).toContain(majorVersion);

		const packageManager = pkg.packageManager;
		expect(packageManager, 'package.json packageManager must be defined').toBeDefined();
	});

	it('All Dockerfiles (3 files) must use the same major Node.js base image as .nvmrc', () => {
		const dockerfiles = ['Dockerfile', 'Dockerfile.lambda', 'Dockerfile.scheduler'];

		for (const file of dockerfiles) {
			const content = read(file);
			// Match all FROM node:<version> statements
			const fromNodeLines = content.split('\n').filter((l) => /^\s*FROM\s+node:/i.test(l));
			expect(fromNodeLines.length, `${file} should declare a FROM node stage`).toBeGreaterThan(0);

			for (const line of fromNodeLines) {
				const match = line.match(/^\s*FROM\s+node:(\d+)/i);
				expect(match, `FROM statement in ${file} must have a valid major version`).not.toBeNull();
				expect(match![1], `Dockerfile ${file} major version mismatch`).toBe(majorVersion);
			}
		}
	});

	it('All Lambda runtimes (4 files) in CDK infrastructure must match the .nvmrc major version', () => {
		const infraFiles = [
			'infra/lib/auth-stack.ts',
			'infra/lib/compute-stack.ts',
			'infra/lib/ops-stack.ts',
			'infra/lib/ses-stack.ts',
		];

		const expectedRuntime = `NODEJS_${majorVersion}_X`;

		for (const file of infraFiles) {
			const content = read(file);
			// Match any occurrences of lambda.Runtime.NODEJS_...
			const matches = content.match(/lambda\.Runtime\.NODEJS_[A-Z0-9_]+/g);
			expect(matches, `${file} should declare at least one Lambda NodeJS runtime`).not.toBeNull();

			for (const match of matches!) {
				expect(match, `CDK stack ${file} Lambda runtime mismatch`).toBe(
					`lambda.Runtime.${expectedRuntime}`,
				);
			}
		}
	});
});
