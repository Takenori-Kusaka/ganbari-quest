import { describe, expect, it } from 'vitest';
import {
	countNg,
	evaluateCoverageRatchet,
	evaluateMergeReadiness,
	formatMergeReadinessMarkdown,
} from '../../../scripts/audit/evaluate-merge-readiness.mjs';

describe('countNg', () => {
	it('finding 形式: severity 3-4 + policy_compliant != true を NG とする', () => {
		const r = countNg([
			{ ruleId: 'a', severity: 4, policy_compliant: false },
			{ ruleId: 'b', severity: 3, policy_compliant: true }, // policy 準拠 → NG ではない
			{ ruleId: 'c', severity: 2, policy_compliant: false }, // 軽微 → NG ではない
		]);
		expect(r.ngCount).toBe(1);
		expect(r.ngItems[0].ruleId).toBe('a');
	});

	it('SARIF result 形式: level=error を NG とする', () => {
		const r = countNg([
			{ ruleId: 'x', level: 'error' },
			{ ruleId: 'y', level: 'warning' },
			{ ruleId: 'z', level: 'note' },
		]);
		expect(r.ngCount).toBe(1);
		expect(r.ngItems[0].ruleId).toBe('x');
	});

	it('空入力は ngCount=0', () => {
		expect(countNg([]).ngCount).toBe(0);
		// @ts-expect-error 防御確認
		expect(countNg(undefined).ngCount).toBe(0);
	});
});

describe('evaluateCoverageRatchet', () => {
	it('null gap map は評価不能 (ratchetOk=null)', () => {
		expect(evaluateCoverageRatchet(null)).toEqual({
			ratchetOk: null,
			belowThresholdCount: 0,
			totalLinePct: null,
		});
	});

	it('zeroCoverageFiles なし + 閾値未指定 → ratchetOk=true', () => {
		const r = evaluateCoverageRatchet({
			total: { lines: { pct: 85 } },
			zeroCoverageFiles: [],
		});
		expect(r.ratchetOk).toBe(true);
		expect(r.totalLinePct).toBe(85);
	});

	it('zeroCoverageFiles 1 件以上 → ratchet 割れ', () => {
		const r = evaluateCoverageRatchet({
			total: { lines: { pct: 90 } },
			zeroCoverageFiles: ['src/a.ts', 'src/b.ts'],
		});
		expect(r.ratchetOk).toBe(false);
		expect(r.belowThresholdCount).toBe(2);
	});

	it('lineThreshold 指定で total.lines.pct 割れを検出', () => {
		const r = evaluateCoverageRatchet(
			{ total: { lines: { pct: 70 } }, zeroCoverageFiles: [] },
			{ lineThreshold: 80 },
		);
		expect(r.ratchetOk).toBe(false);
		expect(r.belowThresholdCount).toBe(1);
	});
});

describe('evaluateMergeReadiness', () => {
	it('NG 0 + coverage ratchet OK + 全 job 緑 → advisory PASS', () => {
		const r = evaluateMergeReadiness({
			findings: [{ ruleId: 'a', severity: 2, policy_compliant: false }],
			coverageGapMap: { total: { lines: { pct: 85 } }, zeroCoverageFiles: [] },
			allGreen: true,
		});
		expect(r.advisoryPass).toBe(true);
		expect(r.ngCount).toBe(0);
		expect(r.reasons[0]).toContain('advisory pass');
	});

	it('NG 残存 → advisory FAIL', () => {
		const r = evaluateMergeReadiness({
			findings: [{ ruleId: 'sec', severity: 4, policy_compliant: false }],
			coverageGapMap: { total: { lines: { pct: 85 } }, zeroCoverageFiles: [] },
			allGreen: true,
		});
		expect(r.advisoryPass).toBe(false);
		expect(r.reasons.some((x) => x.includes('NG 1 件'))).toBe(true);
	});

	it('coverage 未取得 (null) は advisory PASS を出さない (評価不能)', () => {
		const r = evaluateMergeReadiness({
			findings: [],
			coverageGapMap: null,
			allGreen: true,
		});
		expect(r.advisoryPass).toBe(false);
		expect(r.coverageRatchetOk).toBeNull();
		expect(r.reasons.some((x) => x.includes('評価不能'))).toBe(true);
	});

	it('全 job 緑でない → advisory FAIL', () => {
		const r = evaluateMergeReadiness({
			findings: [],
			coverageGapMap: { total: { lines: { pct: 85 } }, zeroCoverageFiles: [] },
			allGreen: false,
		});
		expect(r.advisoryPass).toBe(false);
		expect(r.reasons.some((x) => x.includes('全 job が緑でない'))).toBe(true);
	});

	it('findings なしのとき SARIF results (level) で評価する', () => {
		const r = evaluateMergeReadiness({
			sarifResults: [{ ruleId: 'x', level: 'error' }],
			coverageGapMap: { total: { lines: { pct: 85 } }, zeroCoverageFiles: [] },
			allGreen: true,
		});
		expect(r.ngCount).toBe(1);
		expect(r.advisoryPass).toBe(false);
	});
});

describe('formatMergeReadinessMarkdown', () => {
	it('advisory PASS を明示し block しない旨を含む', () => {
		const md = formatMergeReadinessMarkdown(
			evaluateMergeReadiness({
				findings: [],
				coverageGapMap: { total: { lines: { pct: 85 } }, zeroCoverageFiles: [] },
				allGreen: true,
			}),
		);
		expect(md).toContain('advisory PASS');
		expect(md).toContain('block しない');
		expect(md).toContain('continue-on-error');
	});

	it('advisory FAIL 時は理由を列挙する', () => {
		const md = formatMergeReadinessMarkdown(
			evaluateMergeReadiness({
				findings: [{ ruleId: 'sec', severity: 4, policy_compliant: false }],
				coverageGapMap: null,
				allGreen: false,
			}),
		);
		expect(md).toContain('advisory FAIL');
		expect(md).toContain('理由:');
	});
});
