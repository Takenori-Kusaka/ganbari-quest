// tests/unit/services/challenge-aggregate-service.test.ts
// #1742: runChallengeAggregation のユニットテスト (PR #1696 の analytics-aggregate と同パターン)
//
// 検証:
//   1. dryRun=true: 計算のみ実行、putChallengeAggregate は呼ばれない
//   2. 通常実行: putChallengeAggregate が 1 回呼ばれ、payload に CSV 配列が含まれる
//   3. tenant ごとの settings.getSetting が呼ばれ、結果が CSV 配列にまとめられる
//   4. settings.getSetting 失敗時は空文字 fallback (個別 tenant スキップではない)
//   5. listAllTenants 失敗時は ok=false + 空配列
//   6. targetDate 指定時は default の当日基準を上書き

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

const putChallengeAggregateMock = vi.fn();

vi.mock('$lib/analytics/providers/dynamo', () => ({
	putChallengeAggregate: putChallengeAggregateMock,
}));

const listAllTenantsMock = vi.fn();
const getSettingMock = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { listAllTenants: listAllTenantsMock },
		settings: { getSetting: getSettingMock },
	}),
}));

describe('runChallengeAggregation (#1742)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listAllTenantsMock.mockResolvedValue([
			{ tenantId: 't1', createdAt: '2026-01-01', status: 'active' },
			{ tenantId: 't2', createdAt: '2026-02-01', status: 'active' },
			{ tenantId: 't3', createdAt: '2026-03-01', status: 'active' },
		]);
		getSettingMock.mockImplementation(async (_key: string, tenantId: string) => {
			if (tenantId === 't1') return 'homework-daily,chores';
			if (tenantId === 't2') return 'beyond-games';
			return undefined; // t3 = unanswered
		});
		putChallengeAggregateMock.mockResolvedValue({ ok: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('dryRun=true: 計算のみ、putChallengeAggregate は呼ばれない', async () => {
		const { runChallengeAggregation } = await import(
			'../../../src/lib/server/services/challenge-aggregate-service'
		);
		const result = await runChallengeAggregation({ dryRun: true, targetDate: '2026-04-30' });
		expect(result.dryRun).toBe(true);
		expect(result.targetDate).toBe('2026-04-30');
		expect(result.ok).toBe(true);
		expect(result.totalTenants).toBe(3);
		expect(result.challengesPerTenantCount).toBe(3);
		expect(putChallengeAggregateMock).not.toHaveBeenCalled();
	});

	it('通常実行: putChallengeAggregate が 1 回呼ばれ、CSV 配列が含まれる', async () => {
		const { runChallengeAggregation } = await import(
			'../../../src/lib/server/services/challenge-aggregate-service'
		);
		const result = await runChallengeAggregation({ dryRun: false, targetDate: '2026-04-30' });

		expect(result.targetDate).toBe('2026-04-30');
		expect(result.dryRun).toBe(false);
		expect(result.ok).toBe(true);
		expect(result.written).toBe(true);
		expect(putChallengeAggregateMock).toHaveBeenCalledTimes(1);

		const [date, payload] = putChallengeAggregateMock.mock.calls[0] ?? [];
		expect(date).toBe('2026-04-30');
		expect(payload).toBeDefined();
		expect(payload?.date).toBe('2026-04-30');
		expect(payload?.totalTenants).toBe(3);
		expect(payload?.challengesPerTenant).toEqual([
			'homework-daily,chores',
			'beyond-games',
			'', // t3 unanswered → 空文字
		]);
	});

	it('settings.getSetting が throw した tenant は空文字 fallback (skip しない)', async () => {
		getSettingMock.mockImplementation(async (_key: string, tenantId: string) => {
			if (tenantId === 't1') return 'homework-daily';
			if (tenantId === 't2') throw new Error('settings repo error');
			return 'chores';
		});
		const { runChallengeAggregation } = await import(
			'../../../src/lib/server/services/challenge-aggregate-service'
		);
		const result = await runChallengeAggregation({ dryRun: true, targetDate: '2026-04-30' });
		expect(result.totalTenants).toBe(3);
		expect(result.challengesPerTenantCount).toBe(3);
	});

	it('listAllTenants 失敗時は ok=false + 書込みなし', async () => {
		listAllTenantsMock.mockRejectedValue(new Error('DynamoDB unavailable'));
		const { runChallengeAggregation } = await import(
			'../../../src/lib/server/services/challenge-aggregate-service'
		);
		const result = await runChallengeAggregation({ dryRun: false, targetDate: '2026-04-30' });
		expect(result.ok).toBe(false);
		expect(result.written).toBe(false);
		expect(result.error).toContain('DynamoDB unavailable');
		expect(putChallengeAggregateMock).not.toHaveBeenCalled();
	});

	it('putChallengeAggregate 失敗時は ok=false でエラーを記録', async () => {
		putChallengeAggregateMock.mockResolvedValue({
			ok: false,
			error: 'ProvisionedThroughputExceeded',
		});
		const { runChallengeAggregation } = await import(
			'../../../src/lib/server/services/challenge-aggregate-service'
		);
		const result = await runChallengeAggregation({ dryRun: false, targetDate: '2026-04-30' });
		expect(result.ok).toBe(false);
		expect(result.written).toBe(false);
		expect(result.error).toContain('ProvisionedThroughputExceeded');
	});

	it('targetDate 未指定時は当日 (UTC) を計算する', async () => {
		const { runChallengeAggregation } = await import(
			'../../../src/lib/server/services/challenge-aggregate-service'
		);
		const result = await runChallengeAggregation({ dryRun: true });
		const today = new Date().toISOString().slice(0, 10);
		expect(result.targetDate).toBe(today);
	});

	it('テナント 0 件でも空配列で書き込みは正常完了', async () => {
		listAllTenantsMock.mockResolvedValue([]);
		const { runChallengeAggregation } = await import(
			'../../../src/lib/server/services/challenge-aggregate-service'
		);
		const result = await runChallengeAggregation({ dryRun: false, targetDate: '2026-04-30' });
		expect(result.ok).toBe(true);
		expect(result.totalTenants).toBe(0);
		expect(result.challengesPerTenantCount).toBe(0);
		expect(putChallengeAggregateMock).toHaveBeenCalledTimes(1);
		const [, payload] = putChallengeAggregateMock.mock.calls[0] ?? [];
		expect(payload?.challengesPerTenant).toEqual([]);
		expect(payload?.totalTenants).toBe(0);
	});
});
