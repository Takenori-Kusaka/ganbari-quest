// tests/unit/services/ops-analytics-fetch-challenges.test.ts
//
// #1742: ops-analytics-service.fetchChallengesPerTenant の集計優先 / fallback テスト
//
// `fetchChallengesPerTenant` はファイル内 private 関数なので、外部から見える
// `getAnalyticsData` の挙動を通じて間接的に検証する。
//
// 検証ケース:
//   1. 集計レコードあり → 集計を採用 (settings.getSetting は呼ばれない)
//   2. 集計レコード null → ライブ集計 fallback (settings.getSetting が tenant ごと呼ばれる)
//   3. 集計レコードが空配列 → ライブ集計 fallback (空集計をそのまま使うと preset 分布が歪むため)
//   4. queryLatestChallengeAggregate が throw → ライブ集計 fallback (analytics は never break)
//   5. fallback 経路で settings.getSetting が throw した tenant は空文字 fallback (#1602 既存挙動)

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

const queryLatestChallengeAggregateMock = vi.fn();

vi.mock('$lib/analytics/providers/dynamo', () => ({
	queryLatestChallengeAggregate: queryLatestChallengeAggregateMock,
}));

const listAllTenantsMock = vi.fn();
const getSettingMock = vi.fn();
const cancellationAggregateMock = vi.fn();
const cancellationSearchMock = vi.fn();
const graduationAggregateMock = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { listAllTenants: listAllTenantsMock },
		settings: { getSetting: getSettingMock },
		cancellationReason: {
			aggregateRecent: cancellationAggregateMock,
			searchFreeText: cancellationSearchMock,
		},
		graduationConsent: { aggregateRecent: graduationAggregateMock },
	}),
}));

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => false,
}));

describe('ops-analytics fetchChallengesPerTenant 集計優先 / fallback (#1742)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listAllTenantsMock.mockResolvedValue([
			{
				tenantId: 't1',
				createdAt: '2026-01-01T00:00:00Z',
				status: 'active',
				plan: 'standard_monthly',
			},
			{
				tenantId: 't2',
				createdAt: '2026-02-01T00:00:00Z',
				status: 'active',
				plan: 'family_monthly',
			},
			{
				tenantId: 't3',
				createdAt: '2026-03-01T00:00:00Z',
				status: 'active',
				plan: null,
			},
		]);
		cancellationAggregateMock.mockResolvedValue({ total: 0, breakdown: [] });
		cancellationSearchMock.mockResolvedValue([]);
		graduationAggregateMock.mockResolvedValue({
			totalGraduations: 0,
			consentedCount: 0,
			avgUsagePeriodDays: 0,
			publicSamples: [],
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('集計レコードあり: 集計を採用、settings.getSetting は呼ばれない', async () => {
		queryLatestChallengeAggregateMock.mockResolvedValue({
			date: '2026-04-29',
			totalTenants: 3,
			challengesPerTenant: ['homework-daily', 'beyond-games,chores', 'homework-daily,chores'],
		});

		const { getAnalyticsData } = await import(
			'../../../src/lib/server/services/ops-analytics-service'
		);
		const result = await getAnalyticsData();

		expect(queryLatestChallengeAggregateMock).toHaveBeenCalledTimes(1);
		expect(getSettingMock).not.toHaveBeenCalled();

		// 集計値: homework-daily=2, chores=2, beyond-games=1
		const presetByKey = new Map(result.presetDistribution.rows.map((r) => [r.key, r.count]));
		expect(presetByKey.get('homework-daily')).toBe(2);
		expect(presetByKey.get('chores')).toBe(2);
		expect(presetByKey.get('beyond-games')).toBe(1);
		expect(presetByKey.get('none')).toBe(0); // 全テナント回答済み
	});

	it('集計レコード null: ライブ集計 fallback (settings.getSetting が tenant ごと呼ばれる)', async () => {
		queryLatestChallengeAggregateMock.mockResolvedValue(null);
		getSettingMock.mockImplementation(async (_key: string, tenantId: string) => {
			if (tenantId === 't1') return 'homework-daily';
			if (tenantId === 't2') return 'beyond-games';
			return undefined; // t3 unanswered
		});

		const { getAnalyticsData } = await import(
			'../../../src/lib/server/services/ops-analytics-service'
		);
		const result = await getAnalyticsData();

		expect(queryLatestChallengeAggregateMock).toHaveBeenCalledTimes(1);
		expect(getSettingMock).toHaveBeenCalledTimes(3);

		const presetByKey = new Map(result.presetDistribution.rows.map((r) => [r.key, r.count]));
		expect(presetByKey.get('homework-daily')).toBe(1);
		expect(presetByKey.get('beyond-games')).toBe(1);
		expect(presetByKey.get('none')).toBe(1); // t3 unanswered
	});

	it('集計レコードが空配列: ライブ集計 fallback (歪んだ集計を採用しない)', async () => {
		queryLatestChallengeAggregateMock.mockResolvedValue({
			date: '2026-04-29',
			totalTenants: 0,
			challengesPerTenant: [], // empty → fallback to live
		});
		getSettingMock.mockImplementation(async (_key: string, tenantId: string) => {
			if (tenantId === 't1') return 'chores';
			return undefined;
		});

		const { getAnalyticsData } = await import(
			'../../../src/lib/server/services/ops-analytics-service'
		);
		const result = await getAnalyticsData();

		// 空配列なら fallback でライブが呼ばれる
		expect(getSettingMock).toHaveBeenCalledTimes(3);
		const presetByKey = new Map(result.presetDistribution.rows.map((r) => [r.key, r.count]));
		expect(presetByKey.get('chores')).toBe(1);
	});

	it('queryLatestChallengeAggregate が throw: ライブ集計 fallback (never break the app)', async () => {
		queryLatestChallengeAggregateMock.mockRejectedValue(new Error('DynamoDB Scan timeout'));
		getSettingMock.mockImplementation(async (_key: string, tenantId: string) => {
			if (tenantId === 't1') return 'homework-daily';
			if (tenantId === 't2') return 'chores';
			return 'beyond-games';
		});

		const { getAnalyticsData } = await import(
			'../../../src/lib/server/services/ops-analytics-service'
		);
		const result = await getAnalyticsData();

		// query throw → fallback path
		expect(getSettingMock).toHaveBeenCalledTimes(3);
		expect(result.presetDistribution.totalTenants).toBe(3);
		// 全テナント回答済み (空文字なし)
		const presetByKey = new Map(result.presetDistribution.rows.map((r) => [r.key, r.count]));
		expect(presetByKey.get('none')).toBe(0);
	});

	it('fallback 経路で settings.getSetting が throw した tenant は空文字 fallback (none にカウント)', async () => {
		queryLatestChallengeAggregateMock.mockResolvedValue(null);
		getSettingMock.mockImplementation(async (_key: string, tenantId: string) => {
			if (tenantId === 't1') return 'homework-daily';
			if (tenantId === 't2') throw new Error('settings repo down');
			return undefined; // t3 unanswered
		});

		const { getAnalyticsData } = await import(
			'../../../src/lib/server/services/ops-analytics-service'
		);
		const result = await getAnalyticsData();

		// t1=回答, t2=throw→空文字→none, t3=undefined→空文字→none
		const presetByKey = new Map(result.presetDistribution.rows.map((r) => [r.key, r.count]));
		expect(presetByKey.get('homework-daily')).toBe(1);
		expect(presetByKey.get('none')).toBe(2);
	});
});
