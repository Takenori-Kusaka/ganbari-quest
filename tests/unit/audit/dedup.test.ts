import { describe, expect, it } from 'vitest';
import { dedupeFindings } from '../../../scripts/audit/dedup.mjs';

function f(overrides: Record<string, unknown> = {}) {
	return {
		id: 'x-1',
		title: 't',
		location: 'src/lib/foo.ts:1',
		severity: 2,
		policy_candidate: false,
		detail: 'd',
		ruleId: 'rule-a',
		level: 'warning',
		locations: [{ physicalLocation: { artifactLocation: { uri: 'src/lib/foo.ts' } } }],
		...overrides,
	};
}

describe('dedupeFindings', () => {
	it('空入力は空結果', () => {
		const r = dedupeFindings([]);
		expect(r).toEqual({ merged: [], inputCount: 0, mergedCount: 0, duplicatesRemoved: 0 });
	});

	it('同一 ruleId+正規化 location (行番号違い) を 1 件に統合する', () => {
		const r = dedupeFindings([
			{ team: 'tech', finding: f({ id: 'a', location: 'src/lib/foo.ts:10' }) },
			{ team: 'product', finding: f({ id: 'b', location: 'src/lib/foo.ts:99' }) },
		]);
		expect(r.inputCount).toBe(2);
		expect(r.mergedCount).toBe(1);
		expect(r.duplicatesRemoved).toBe(1);
		expect(r.merged[0].merged_from).toHaveLength(2);
	});

	it('ruleId が違えば統合しない', () => {
		const r = dedupeFindings([
			{ team: 'tech', finding: f({ id: 'a', ruleId: 'rule-a' }) },
			{ team: 'tech', finding: f({ id: 'b', ruleId: 'rule-b' }) },
		]);
		expect(r.mergedCount).toBe(2);
		expect(r.duplicatesRemoved).toBe(0);
	});

	it('統合時は群内最大 severity に引き上げる', () => {
		const r = dedupeFindings([
			{ team: 'tech', finding: f({ id: 'a', severity: 2 }) },
			{ team: 'security', finding: f({ id: 'b', severity: 4 }) },
		]);
		expect(r.mergedCount).toBe(1);
		expect(r.merged[0].severity).toBe(4);
	});

	it('merged_from に出所 team / id を記録する (無言マージしない)', () => {
		const r = dedupeFindings([
			{ team: 'tech', finding: f({ id: 'a' }) },
			{ team: 'security', finding: f({ id: 'b' }) },
		]);
		expect(r.merged[0].merged_from).toEqual([
			{ team: 'tech', id: 'a' },
			{ team: 'security', id: 'b' },
		]);
	});

	it('partialFingerprints.primary が一致すれば location が違っても統合する', () => {
		const r = dedupeFindings([
			{
				team: 'tech',
				finding: f({ id: 'a', location: 'aaa.ts:1', partialFingerprints: { primary: 'FP' } }),
			},
			{
				team: 'product',
				finding: f({ id: 'b', location: 'bbb.ts:1', partialFingerprints: { primary: 'FP' } }),
			},
		]);
		expect(r.mergedCount).toBe(1);
	});

	it('各 merged finding に fingerprint が付く', () => {
		const r = dedupeFindings([{ team: 'tech', finding: f() }]);
		expect(typeof r.merged[0].fingerprint).toBe('string');
		expect(r.merged[0].fingerprint.length).toBeGreaterThan(0);
	});

	it('代表 finding は最大 severity 側の本文を採用する', () => {
		const r = dedupeFindings([
			{ team: 'tech', finding: f({ id: 'low', severity: 1, title: 'low title' }) },
			{ team: 'security', finding: f({ id: 'high', severity: 4, title: 'high title' }) },
		]);
		expect(r.merged[0].title).toBe('high title');
	});
});
