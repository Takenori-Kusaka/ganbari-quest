import { describe, expect, it } from 'vitest';
import { buildAggregateReport } from '../../../scripts/audit/aggregate-report.mjs';

function baseInput(overrides: Record<string, unknown> = {}) {
	return {
		runId: 'baseline-20260610',
		scope: 'baseline',
		integrationPr: 0,
		generatedAt: '2026-06-10T13:00:00.000Z',
		stats: {
			rawFindingCount: 5,
			mergedCount: 3,
			duplicatesRemoved: 2,
			escalatedCount: 1,
			backlogCount: 2,
		},
		rejectedEvidence: [],
		escalated: [
			{
				id: 'security-1',
				team: 'security',
				ruleId: 'authz/x',
				severity: 4,
				title: 'tenant 欠落',
				location: 'src/foo.ts',
				merged_from: [{ team: 'security', id: 'security-1' }],
			},
		],
		backlog: [
			{
				id: 'tech-1',
				team: 'tech',
				ruleId: 'r',
				severity: 2,
				title: 'a',
				location: 'b',
				merged_from: [{}],
			},
			{
				id: 'tech-2',
				team: 'tech',
				ruleId: 'r2',
				severity: 1,
				title: 'c',
				location: 'd',
				merged_from: [{}],
			},
		],
		...overrides,
	};
}

describe('buildAggregateReport', () => {
	it('AC4 件数サマリを全件出力する', () => {
		const md = buildAggregateReport(baseInput());
		expect(md).toContain('全件発露 (raw findings) | 5');
		expect(md).toContain('重複統合後 | 3');
		expect(md).toContain('重複統合で除去 | 2');
		expect(md).toContain('起票候補 (severity 3-4 → 次段 policy filter へ) | 1');
		expect(md).toContain('backlog 蓄積のみ (severity 1-2) | 2');
		expect(md).toContain('自動棄却 (schema 不充足 / URL 欠落) | 0');
	});

	it('run メタ (run_id / scope / generated_at) を含む', () => {
		const md = buildAggregateReport(baseInput());
		expect(md).toContain('baseline-20260610');
		expect(md).toContain('| scope | baseline |');
		expect(md).toContain('2026-06-10T13:00:00.000Z');
	});

	it('baseline は integration_pr=0 を「差分非依存」と明示する', () => {
		const md = buildAggregateReport(baseInput());
		expect(md).toContain('0 (baseline / 差分非依存)');
	});

	it('integration scope では #PR を表示する', () => {
		const md = buildAggregateReport(baseInput({ scope: 'integration', integrationPr: 2950 }));
		expect(md).toContain('| integration_pr | #2950 |');
	});

	it('起票候補テーブルに finding 行を出す', () => {
		const md = buildAggregateReport(baseInput());
		expect(md).toContain('| security-1 | security | authz/x | 4 | 1 | tenant 欠落 | src/foo.ts |');
	});

	it('起票候補が「起票確定でない」旨を明記する (誤起票防止)', () => {
		const md = buildAggregateReport(baseInput());
		expect(md).toContain('起票確定ではない');
		expect(md).toContain('policy-compliance');
	});

	it('escalated / backlog 空時は「該当なし」を出す', () => {
		const md = buildAggregateReport(baseInput({ escalated: [], backlog: [] }));
		expect(md).toContain('_(該当なし)_');
	});

	it('自動棄却理由を列挙する (無言棄却しない)', () => {
		const md = buildAggregateReport(baseInput({ rejectedEvidence: ['file foo.json: URL 欠落'] }));
		expect(md).toContain('- file foo.json: URL 欠落');
	});

	it('title 内の | をエスケープする (markdown table 破壊防止)', () => {
		const md = buildAggregateReport(
			baseInput({
				escalated: [
					{
						id: 'a',
						team: 't',
						ruleId: 'r',
						severity: 3,
						title: 'a | b',
						location: 'x',
						merged_from: [{}],
					},
				],
			}),
		);
		expect(md).toContain('a \\| b');
	});
});
