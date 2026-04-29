// tests/unit/services/analytics-aggregate-service.test.ts
// #1693 (#1639 follow-up): runAnalyticsAggregation のユニットテスト
//
// 検証:
//   1. dryRun=true: 計算のみ実行、putAnalyticsAggregate は呼ばれない
//   2. 通常実行: putAnalyticsAggregate が funnel + cancellation 30d/90d で 3 回呼ばれる
//   3. funnel 集計エラー時に cancellation は継続実行される
//   4. targetDate 指定時は前日デフォルトを上書き

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		critical: vi.fn(),
	},
}));

const putAggregateMock = vi.fn();

vi.mock('$lib/analytics/providers/dynamo', () => ({
	putAnalyticsAggregate: putAggregateMock,
	ANALYTICS_AGG_KIND: {
		FUNNEL: 'FUNNEL',
		CANCELLATION_30D: 'CANCELLATION_30D',
		CANCELLATION_90D: 'CANCELLATION_90D',
	},
}));

const cancellationAggregationMock = vi.fn();

vi.mock('$lib/server/services/cancellation-service', () => ({
	getCancellationReasonAggregation: cancellationAggregationMock,
}));

// QueryCommand mock for funnel aggregation
const queryCommandSendMock = vi.fn();
vi.mock('@aws-sdk/lib-dynamodb', async () => {
	const actual =
		await vi.importActual<typeof import('@aws-sdk/lib-dynamodb')>('@aws-sdk/lib-dynamodb');
	return {
		...actual,
		QueryCommand: actual.QueryCommand,
	};
});

vi.mock('$lib/server/db/dynamodb/client', () => ({
	getDocClient: () => ({ send: queryCommandSendMock }),
	TABLE_NAME: 'test-table',
}));

describe('runAnalyticsAggregation (#1693)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: empty event query, empty cancellation
		queryCommandSendMock.mockResolvedValue({ Items: [], LastEvaluatedKey: undefined });
		cancellationAggregationMock.mockResolvedValue({ total: 0, breakdown: [] });
		putAggregateMock.mockResolvedValue({ ok: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('dryRun=true: 計算のみ、putAnalyticsAggregate は呼ばれない', async () => {
		const { runAnalyticsAggregation } = await import(
			'../../../src/lib/server/services/analytics-aggregate-service'
		);
		const result = await runAnalyticsAggregation({ dryRun: true, targetDate: '2026-04-28' });
		expect(result.dryRun).toBe(true);
		expect(result.targetDate).toBe('2026-04-28');
		expect(result.ok).toBe(true);
		expect(putAggregateMock).not.toHaveBeenCalled();
	});

	it('通常実行: funnel + cancellation 30d/90d の合計 3 回 PutItem', async () => {
		const { runAnalyticsAggregation } = await import(
			'../../../src/lib/server/services/analytics-aggregate-service'
		);
		const result = await runAnalyticsAggregation({ dryRun: false, targetDate: '2026-04-28' });

		expect(result.targetDate).toBe('2026-04-28');
		expect(result.dryRun).toBe(false);
		expect(putAggregateMock).toHaveBeenCalledTimes(3);

		// 1 件目: FUNNEL
		const [date1, kind1, payload1] = putAggregateMock.mock.calls[0] ?? [];
		expect(date1).toBe('2026-04-28');
		expect(kind1).toBe('FUNNEL');
		expect(payload1).toBeDefined();

		// 2-3 件目: CANCELLATION_30D / CANCELLATION_90D (Promise.all なので順序保証なし)
		const cancellationCalls = putAggregateMock.mock.calls.slice(1).map((c) => c[1]);
		expect(cancellationCalls).toContain('CANCELLATION_30D');
		expect(cancellationCalls).toContain('CANCELLATION_90D');
	});

	it('funnel query が events を返したら uniqueTenantsByEvent に反映', async () => {
		// signup event のみ 3 unique tenant
		let callCount = 0;
		queryCommandSendMock.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve({
					Items: [
						{ tenantId: 't1', GSI2SK: '2026-04-28#t1' },
						{ tenantId: 't2', GSI2SK: '2026-04-28#t2' },
						{ tenantId: 't3', GSI2SK: '2026-04-28#t3' },
					],
					LastEvaluatedKey: undefined,
				});
			}
			return Promise.resolve({ Items: [], LastEvaluatedKey: undefined });
		});

		const { runAnalyticsAggregation } = await import(
			'../../../src/lib/server/services/analytics-aggregate-service'
		);
		const result = await runAnalyticsAggregation({ dryRun: true, targetDate: '2026-04-28' });
		expect(result.funnel.uniqueTenantsByEvent.activation_signup_completed).toBe(3);
		expect(result.funnel.uniqueTenantsByEvent.activation_first_child_added).toBe(0);
	});

	it('cancellation aggregation 結果が反映される', async () => {
		cancellationAggregationMock.mockImplementation((days: number) =>
			Promise.resolve({
				total: days === 30 ? 5 : 12,
				breakdown: [
					{ category: 'graduation', count: days === 30 ? 2 : 5, percentage: 0 },
					{ category: 'churn', count: days === 30 ? 3 : 7, percentage: 0 },
				],
			}),
		);

		const { runAnalyticsAggregation } = await import(
			'../../../src/lib/server/services/analytics-aggregate-service'
		);
		const result = await runAnalyticsAggregation({ dryRun: true, targetDate: '2026-04-28' });
		expect(result.cancellation.total30d).toBe(5);
		expect(result.cancellation.total90d).toBe(12);
	});

	it('putAnalyticsAggregate 失敗時 ok=false でエラーを記録', async () => {
		putAggregateMock.mockResolvedValue({ ok: false, error: 'ProvisionedThroughputExceeded' });
		const { runAnalyticsAggregation } = await import(
			'../../../src/lib/server/services/analytics-aggregate-service'
		);
		const result = await runAnalyticsAggregation({ dryRun: false, targetDate: '2026-04-28' });
		expect(result.ok).toBe(false);
		expect(result.funnel.error).toContain('ProvisionedThroughputExceeded');
	});

	it('targetDate 未指定時は前日 (UTC) を計算する', async () => {
		const { runAnalyticsAggregation } = await import(
			'../../../src/lib/server/services/analytics-aggregate-service'
		);
		const result = await runAnalyticsAggregation({ dryRun: true });
		const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		expect(result.targetDate).toBe(yesterday);
	});

	it('cancellation throw 時も funnel 結果は保持される (部分縮退)', async () => {
		cancellationAggregationMock.mockRejectedValue(new Error('cancellation repo down'));
		const { runAnalyticsAggregation } = await import(
			'../../../src/lib/server/services/analytics-aggregate-service'
		);
		const result = await runAnalyticsAggregation({ dryRun: false, targetDate: '2026-04-28' });
		expect(result.cancellation.error).toContain('cancellation repo down');
		expect(result.ok).toBe(false);
		// funnel は成功 (空 query 結果のみ)
		expect(result.funnel.error).toBeNull();
	});
});
