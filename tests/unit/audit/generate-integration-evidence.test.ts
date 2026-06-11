import { describe, expect, it } from 'vitest';
import {
	B1_PLACEHOLDER,
	buildEvidence,
	buildJobResultTable,
} from '../../../scripts/audit/generate-integration-evidence.mjs';

describe('buildJobResultTable', () => {
	it('toJSON(needs) を job 名昇順の結果表に変換する', () => {
		expect(
			buildJobResultTable({
				'unit-test': { result: 'success' },
				'e2e-test': { result: 'failure' },
			}),
		).toEqual([
			{ job: 'e2e-test', result: 'failure' },
			{ job: 'unit-test', result: 'success' },
		]);
	});

	it('result 欠落は unknown / null needs は空表 (壊れない)', () => {
		expect(buildJobResultTable({ x: {} })).toEqual([{ job: 'x', result: 'unknown' }]);
		// @ts-expect-error null 入力の防御確認
		expect(buildJobResultTable(null)).toEqual([]);
	});
});

describe('buildEvidence', () => {
	const baseInput = {
		needs: {
			'e2e-matrix': { result: 'success' },
			'e2e-test': { result: 'failure' },
		},
		coverageGapMap: null,
		apiCoverageMap: null,
		runId: 'run-1',
		prNumber: '9999',
		generatedAt: '2026-06-11T00:00:00Z',
	};

	it('§3.5 #3 テスト結果表を markdown に含める', () => {
		const { markdown } = buildEvidence(baseInput);
		expect(markdown).toContain('| e2e-matrix | success |');
		expect(markdown).toContain('| e2e-test | failure |');
	});

	it('fail run でも生成され、failedJobCount に集計される (全件発露の入力)', () => {
		const { json, markdown } = buildEvidence(baseInput);
		expect(json.failedJobCount).toBe(1);
		expect(markdown).toContain('failure / cancelled: 1 件 (e2e-test)');
	});

	it('#1 含有 PR 一覧 / #2 変更×テスト突合 / #5 残 NG は B-1 placeholder で境界明示する', () => {
		const { json, markdown } = buildEvidence(baseInput);
		expect(json.includedChanges).toBeNull();
		expect(json.changeTestMapping).toBeNull();
		expect(json.remainingNg).toBeNull();
		expect(markdown.split(B1_PLACEHOLDER)).toHaveLength(4); // 3 箇所に出現
	});

	it('coverage 未取得時はその旨を markdown に明示する', () => {
		const { markdown } = buildEvidence(baseInput);
		expect(markdown).toContain('coverage-summary.json 未取得');
	});

	it('coverage / apiCoverage がある場合は表を埋め込む', () => {
		const { markdown, json } = buildEvidence({
			...baseInput,
			coverageGapMap: {
				total: { lines: { total: 10, covered: 5, pct: 50 } },
				dirs: [{ dir: 'src/lib/server', files: 1, linesTotal: 10, linesCovered: 5, pct: 50 }],
				zeroCoverageFiles: [],
				untrackedSrcFiles: [],
			},
			apiCoverageMap: {
				covered: [{ method: 'GET', path: '/api/health' }],
				uncovered: [],
				total: 1,
				coverageRate: 100,
			},
		});
		expect(markdown).toContain('全体 lines: 5/10 (50%)');
		expect(markdown).toContain('カバー率: 100%');
		expect(json.coverage).not.toBeNull();
		expect(json.apiCoverage).not.toBeNull();
	});

	it('json は schema 識別子 + run / PR メタを持つ (E1 エビデンス表へ渡す形)', () => {
		const { json } = buildEvidence(baseInput);
		expect(json.schema).toBe('integration-pr-evidence/v1');
		expect(json.runId).toBe('run-1');
		expect(json.prNumber).toBe('9999');
		expect(json.generatedAt).toBe('2026-06-11T00:00:00Z');
	});
});
