// tests/unit/domain/activity-source-sanitize-4693.test.ts
//
// #4693 (QM #4784): backup の `source` は顧客が編集できる入力なので、値域 SSOT の外は既定 (`seed`) に倒す。
// `in` 判定だと継承プロパティ名 ('constructor' 等) が素通りして DB に書かれる。
import { describe, expect, it } from 'vitest';
import { ACTIVITY_SOURCES, sanitizeActivitySource } from '../../../src/lib/domain/activity-source';

describe('#4693 sanitizeActivitySource (default-deny)', () => {
	it('値域内の値はそのまま通す', () => {
		for (const code of Object.keys(ACTIVITY_SOURCES)) {
			expect(sanitizeActivitySource(code)).toBe(code);
		}
	});

	it.each([
		'constructor',
		'toString',
		'valueOf',
		'__proto__',
		'hasOwnProperty',
	])('継承プロパティ名 %s は値域外として seed に倒す', (raw) => {
		expect(sanitizeActivitySource(raw)).toBe(ACTIVITY_SOURCES.seed.value);
	});

	it('未知の文字列 / 非文字列 / 欠落は seed に倒す', () => {
		expect(sanitizeActivitySource('bogus')).toBe('seed');
		expect(sanitizeActivitySource(42)).toBe('seed');
		expect(sanitizeActivitySource(undefined)).toBe('seed');
		expect(sanitizeActivitySource(null)).toBe('seed');
	});
});
