/**
 * tests/unit/scripts/check-native-dep-pin.test.ts (#3302)
 *
 * check-native-dep-pin.mjs の SIGSEGV-safe pin 逸脱検出を回帰固定する (ADR-0061: guard は test で守る)。
 * #3197 の runtime smoke がすり抜けた dependabot #3293 (better-sqlite3 12.11.1) を、本 gate が
 * package.json + lock の静的照合で hard-fail することを境界ごとに検証する。
 */

import { describe, expect, it } from 'vitest';
import { findPinViolations, SIGSEGV_SAFE_PINS } from '../../../scripts/check-native-dep-pin.mjs';

const PIN = [{ name: 'better-sqlite3', version: '12.10.0', reason: 'test' }];

/** lock の最小形 (node_modules/<name>.version を持つ packages map)。 */
function lock(version: string | undefined) {
	const packages: Record<string, { version?: string }> = { '': {} };
	if (version !== undefined) packages['node_modules/better-sqlite3'] = { version };
	return { packages };
}

describe('check-native-dep-pin findPinViolations (#3302)', () => {
	it('pin 一致 (package.json + lock とも 12.10.0) なら違反 0', () => {
		const pkg = { dependencies: { 'better-sqlite3': '12.10.0' } };
		expect(findPinViolations(pkg, lock('12.10.0'), PIN)).toEqual([]);
	});

	it('package.json が 12.11.1 (#3293 regression) を violation 検出する', () => {
		const pkg = { dependencies: { 'better-sqlite3': '12.11.1' } };
		const v = findPinViolations(pkg, lock('12.11.1'), PIN);
		// package.json と lock 両方で逸脱 → 2 件
		expect(v).toHaveLength(2);
		expect(v.some((x) => x.where === 'package.json' && x.actual === '12.11.1')).toBe(true);
		expect(v.some((x) => x.where === 'package-lock.json' && x.actual === '12.11.1')).toBe(true);
	});

	it('lock のみ逸脱 (package.json は 12.10.0 だが lock が 12.11.1) も検出する', () => {
		const pkg = { dependencies: { 'better-sqlite3': '12.10.0' } };
		const v = findPinViolations(pkg, lock('12.11.1'), PIN);
		expect(v).toHaveLength(1);
		expect(v[0]?.where).toBe('package-lock.json');
	});

	it('caret / range 指定 (^12.10.0) は exact pin でないため violation', () => {
		const pkg = { dependencies: { 'better-sqlite3': '^12.10.0' } };
		const v = findPinViolations(pkg, lock('12.10.0'), PIN);
		expect(v.some((x) => x.where === 'package.json' && x.actual === '^12.10.0')).toBe(true);
	});

	it('依存未宣言 / lock entry 欠落も検出する', () => {
		const v = findPinViolations({ dependencies: {} }, lock(undefined), PIN);
		expect(v).toHaveLength(2);
		expect(v.some((x) => x.actual.includes('未宣言'))).toBe(true);
		expect(v.some((x) => x.actual.includes('lock'))).toBe(true);
	});

	it('devDependencies 側の pin も照合する', () => {
		const pkg = { devDependencies: { 'better-sqlite3': '12.10.0' } };
		expect(findPinViolations(pkg, lock('12.10.0'), PIN)).toEqual([]);
	});

	it('SSOT (SIGSEGV_SAFE_PINS) に better-sqlite3@12.10.0 を含む', () => {
		const bs = SIGSEGV_SAFE_PINS.find((p) => p.name === 'better-sqlite3');
		expect(bs?.version).toBe('12.10.0');
		expect(bs?.reason).toMatch(/SIGSEGV/);
	});
});
