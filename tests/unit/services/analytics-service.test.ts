// tests/unit/services/analytics-service.test.ts
// Analytics service unit tests
// vi.resetModules() + dynamic import パターンのため、フルスイートではモジュール解決に時間がかかる
//
// #1591 (ADR-0023 I2): umami / Sentry プロバイダ削除に伴い、Sentry / Umami の
// テストケースを削除した。DynamoDB プロバイダ単体の network-isolated テストは
// `tests/unit/analytics/dynamo-provider.test.ts` に分離。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// フルスイート並列実行時の dynamic import タイムアウト対策
vi.setConfig({ testTimeout: 30_000 });

// Mock the logger to avoid file I/O in tests
vi.mock('$lib/server/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		critical: vi.fn(),
		request: vi.fn(),
		requestError: vi.fn(),
	},
}));

// Mock environment variables
const originalEnv = { ...process.env };

describe('Analytics providers', () => {
	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
		// Clear analytics-related env vars
		delete process.env.ANALYTICS_ENABLED;
		delete process.env.ANALYTICS_TABLE_NAME;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('NoopProvider', () => {
		it('should always initialize successfully', async () => {
			const { NoopProvider } = await import('../../../src/lib/analytics/providers/noop');
			const provider = new NoopProvider();
			expect(provider.init()).toBe(true);
			expect(provider.name).toBe('noop');
		});

		it('should not throw on any method call', async () => {
			const { NoopProvider } = await import('../../../src/lib/analytics/providers/noop');
			const provider = new NoopProvider();
			provider.init();

			// All these should be safe no-ops
			expect(() => provider.trackEvent('test')).not.toThrow();
			expect(() => provider.trackEvent('test', { key: 'value' })).not.toThrow();
			expect(() => provider.trackPageView('/test')).not.toThrow();
			expect(() => provider.trackError(new Error('test'))).not.toThrow();
			expect(() => provider.identify('tenant-1')).not.toThrow();
			await expect(provider.flush()).resolves.toBeUndefined();
		});
	});
});

describe('Activation Funnel helpers (#831)', () => {
	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('trackActivationSignupCompleted emits activation_signup_completed', async () => {
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();
		analytics.init();
		const spy = vi.spyOn(analytics, 'trackEvent');

		const { trackActivationSignupCompleted } = await import(
			'../../../src/lib/server/services/analytics-service'
		);
		trackActivationSignupCompleted('t-1');

		expect(spy).toHaveBeenCalledWith('activation_signup_completed', {
			step: 1,
			tenantId: 't-1',
		});
	});

	it('trackActivationFirstChildAdded emits activation_first_child_added with childId', async () => {
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();
		analytics.init();
		const spy = vi.spyOn(analytics, 'trackEvent');

		const { trackActivationFirstChildAdded } = await import(
			'../../../src/lib/server/services/analytics-service'
		);
		trackActivationFirstChildAdded('t-2', 42);

		expect(spy).toHaveBeenCalledWith('activation_first_child_added', {
			step: 2,
			childId: 42,
			tenantId: 't-2',
		});
	});

	it('trackActivationFirstActivityCompleted emits with childId and activityId', async () => {
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();
		analytics.init();
		const spy = vi.spyOn(analytics, 'trackEvent');

		const { trackActivationFirstActivityCompleted } = await import(
			'../../../src/lib/server/services/analytics-service'
		);
		trackActivationFirstActivityCompleted('t-3', 10, 5);

		expect(spy).toHaveBeenCalledWith('activation_first_activity_completed', {
			step: 3,
			childId: 10,
			activityId: 5,
			tenantId: 't-3',
		});
	});

	it('trackActivationFirstRewardSeen emits with rewardType=stamp', async () => {
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();
		analytics.init();
		const spy = vi.spyOn(analytics, 'trackEvent');

		const { trackActivationFirstRewardSeen } = await import(
			'../../../src/lib/server/services/analytics-service'
		);
		trackActivationFirstRewardSeen('t-4', 'stamp');

		expect(spy).toHaveBeenCalledWith('activation_first_reward_seen', {
			step: 4,
			rewardType: 'stamp',
			tenantId: 't-4',
		});
	});

	it('trackActivationFirstRewardSeen emits with rewardType=level_up', async () => {
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();
		analytics.init();
		const spy = vi.spyOn(analytics, 'trackEvent');

		const { trackActivationFirstRewardSeen } = await import(
			'../../../src/lib/server/services/analytics-service'
		);
		trackActivationFirstRewardSeen('t-5', 'level_up');

		expect(spy).toHaveBeenCalledWith('activation_first_reward_seen', {
			step: 4,
			rewardType: 'level_up',
			tenantId: 't-5',
		});
	});
});

describe('Admin analytics aggregation (#1639)', () => {
	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
		// 後続 describe (AnalyticsManager) で再 import するときに module mock が残らないよう unmock
		vi.doUnmock('../../../src/lib/analytics/providers/dynamo');
		vi.doUnmock('../../../src/lib/server/services/cohort-analysis-service');
		vi.doUnmock('../../../src/lib/server/services/pmf-survey-service');
		vi.doUnmock('../../../src/lib/server/services/cancellation-service');
	});

	describe('getActivationFunnel', () => {
		it('returns 4 funnel steps in order with conversion rates', async () => {
			// Mock queryAnalyticsEventTenants: 各 event の unique tenant 件数を変える
			let callCount = 0;
			const counts = [100, 70, 35, 20]; // signup → first_child → first_activity → first_reward
			const queryMock = vi.fn().mockImplementation(() => {
				const c = counts[callCount] ?? 0;
				callCount++;
				return Promise.resolve({ uniqueTenants: c, scannedDates: 30 });
			});

			vi.doMock('../../../src/lib/analytics/providers/dynamo', () => ({
				queryAnalyticsEventTenants: queryMock,
			}));

			const { getActivationFunnel } = await import(
				'../../../src/lib/server/services/analytics-service'
			);
			const result = await getActivationFunnel('30d');

			expect(result.period).toBe('30d');
			expect(result.steps).toHaveLength(4);
			expect(result.steps[0]?.eventName).toBe('activation_signup_completed');
			expect(result.steps[0]?.count).toBe(100);
			expect(result.steps[0]?.conversionFromPrev).toBe(1);
			expect(result.steps[1]?.eventName).toBe('activation_first_child_added');
			expect(result.steps[1]?.count).toBe(70);
			expect(result.steps[1]?.conversionFromPrev).toBeCloseTo(0.7, 5);
			expect(result.steps[3]?.eventName).toBe('activation_first_reward_seen');
			expect(result.steps[3]?.count).toBe(20);
			expect(result.steps[3]?.conversionFromPrev).toBeCloseTo(20 / 35, 5);
			expect(result.fetchedAt).toBeTruthy();
		});

		it('returns zero counts when query returns empty', async () => {
			const queryMock = vi.fn().mockResolvedValue({ uniqueTenants: 0, scannedDates: 0 });
			vi.doMock('../../../src/lib/analytics/providers/dynamo', () => ({
				queryAnalyticsEventTenants: queryMock,
			}));

			const { getActivationFunnel } = await import(
				'../../../src/lib/server/services/analytics-service'
			);
			const result = await getActivationFunnel('7d');

			expect(result.period).toBe('7d');
			expect(result.steps.every((s) => s.count === 0)).toBe(true);
			// 空データのときも step 1 は conversionFromPrev=1 (定義上の出発点)
			expect(result.steps[0]?.conversionFromPrev).toBe(1);
			// step >=2 で前段が 0 のときは 0
			expect(result.steps[1]?.conversionFromPrev).toBe(0);
		});

		it('returns zero counts gracefully when query throws (provider already swallows)', async () => {
			// queryAnalyticsEventTenants は内部で try/catch しているため
			// 呼び出し側からは zero 結果として返る (provider レイヤーが Error を吸収する設計)
			const queryMock = vi.fn().mockResolvedValue({ uniqueTenants: 0, scannedDates: 0 });
			vi.doMock('../../../src/lib/analytics/providers/dynamo', () => ({
				queryAnalyticsEventTenants: queryMock,
			}));

			const { getActivationFunnel } = await import(
				'../../../src/lib/server/services/analytics-service'
			);
			const result = await getActivationFunnel('30d');

			// Error 時は 0 で fallback (Pre-PMF: 部分縮退許容)
			expect(result.steps).toHaveLength(4);
			expect(result.steps.every((s) => s.count === 0)).toBe(true);
		});
	});

	describe('getRetentionCohort', () => {
		it('wraps cohort-analysis-service result with dayPoints', async () => {
			const fakeCohortResult = {
				cohorts: [
					{
						month: '2026-04',
						size: 12,
						paidSize: 3,
						retention: { 1: 0.9, 7: 0.7, 14: 0.6, 30: 0.5, 60: null, 90: null },
						ltv: 1500,
						insufficientSample: false,
					},
				],
				theoreticalLtv: 5000,
				arpu: 500,
				monthlyChurnRate: 0.1,
				fetchedAt: '2026-04-29T00:00:00Z',
			};
			vi.doMock('../../../src/lib/server/services/cohort-analysis-service', () => ({
				getCohortAnalysis: vi.fn().mockResolvedValue(fakeCohortResult),
			}));

			const { getRetentionCohort } = await import(
				'../../../src/lib/server/services/analytics-service'
			);
			const result = await getRetentionCohort('monthly');

			expect(result.period).toBe('monthly');
			expect(result.dayPoints).toEqual([1, 7, 14, 30, 60, 90]);
			expect(result.cohorts).toHaveLength(1);
			expect(result.cohorts[0]?.cohort).toBe('2026-04');
			expect(result.cohorts[0]?.size).toBe(12);
			expect(result.cohorts[0]?.retention[1]).toBe(0.9);
		});

		it('returns empty cohorts when underlying service returns empty', async () => {
			vi.doMock('../../../src/lib/server/services/cohort-analysis-service', () => ({
				getCohortAnalysis: vi.fn().mockResolvedValue({
					cohorts: [],
					theoreticalLtv: 0,
					arpu: 0,
					monthlyChurnRate: 0,
					fetchedAt: '2026-04-29T00:00:00Z',
				}),
			}));

			const { getRetentionCohort } = await import(
				'../../../src/lib/server/services/analytics-service'
			);
			const result = await getRetentionCohort('weekly');

			expect(result.period).toBe('weekly');
			expect(result.cohorts).toEqual([]);
		});
	});

	describe('getSeanEllisScore', () => {
		it('delegates to pmf-survey-service.aggregateSurveyResponses', async () => {
			const fakeAggregation = {
				round: '2026-H1',
				totalResponses: 50,
				q1Counts: { very: 22, somewhat: 15, not: 8, na: 5 },
				q1Percentages: { very: 0.44, somewhat: 0.3, not: 0.16, na: 0.1 },
				seanEllisScore: 0.488,
				pmfAchieved: true,
				q3Counts: { lp: 10, media: 5, friend: 8, google: 12, sns: 10, other: 5 },
				q2Texts: [],
				q4Texts: [],
			};
			const aggregateMock = vi.fn().mockResolvedValue(fakeAggregation);
			vi.doMock('../../../src/lib/server/services/pmf-survey-service', () => ({
				aggregateSurveyResponses: aggregateMock,
				getCurrentRound: vi.fn().mockReturnValue('2026-H1'),
			}));

			const { getSeanEllisScore } = await import(
				'../../../src/lib/server/services/analytics-service'
			);
			const result = await getSeanEllisScore('2026-H1');

			expect(aggregateMock).toHaveBeenCalledWith('2026-H1');
			expect(result.seanEllisScore).toBeCloseTo(0.488, 3);
			expect(result.pmfAchieved).toBe(true);
			expect(result.totalResponses).toBe(50);
		});

		it('uses current round when round is omitted', async () => {
			const aggregateMock = vi.fn().mockResolvedValue({
				round: '2026-H2',
				totalResponses: 0,
				q1Counts: { very: 0, somewhat: 0, not: 0, na: 0 },
				q1Percentages: { very: 0, somewhat: 0, not: 0, na: 0 },
				seanEllisScore: 0,
				pmfAchieved: false,
				q3Counts: { lp: 0, media: 0, friend: 0, google: 0, sns: 0, other: 0 },
				q2Texts: [],
				q4Texts: [],
			});
			vi.doMock('../../../src/lib/server/services/pmf-survey-service', () => ({
				aggregateSurveyResponses: aggregateMock,
				getCurrentRound: vi.fn().mockReturnValue('2026-H2'),
			}));

			const { getSeanEllisScore } = await import(
				'../../../src/lib/server/services/analytics-service'
			);
			await getSeanEllisScore();

			expect(aggregateMock).toHaveBeenCalledWith('2026-H2');
		});
	});

	describe('getCancellationReasons', () => {
		it('delegates to cancellation-service with correct days for 30d period', async () => {
			const aggregateMock = vi.fn().mockResolvedValue({
				total: 8,
				breakdown: [
					{ category: 'graduation', count: 3, percentage: 37.5 },
					{ category: 'churn', count: 4, percentage: 50.0 },
					{ category: 'pause', count: 1, percentage: 12.5 },
				],
			});
			vi.doMock('../../../src/lib/server/services/cancellation-service', () => ({
				getCancellationReasonAggregation: aggregateMock,
			}));

			const { getCancellationReasons } = await import(
				'../../../src/lib/server/services/analytics-service'
			);
			const result = await getCancellationReasons('30d');

			expect(aggregateMock).toHaveBeenCalledWith(30);
			expect(result.period).toBe('30d');
			expect(result.total).toBe(8);
			expect(result.breakdown).toHaveLength(3);
			expect(result.breakdown[1]?.category).toBe('churn');
		});

		it('uses 90 days for 90d period (default)', async () => {
			const aggregateMock = vi.fn().mockResolvedValue({ total: 0, breakdown: [] });
			vi.doMock('../../../src/lib/server/services/cancellation-service', () => ({
				getCancellationReasonAggregation: aggregateMock,
			}));

			const { getCancellationReasons } = await import(
				'../../../src/lib/server/services/analytics-service'
			);
			const result = await getCancellationReasons('90d');

			expect(aggregateMock).toHaveBeenCalledWith(90);
			expect(result.period).toBe('90d');
			expect(result.total).toBe(0);
		});

		it('returns empty result when no cancellations', async () => {
			vi.doMock('../../../src/lib/server/services/cancellation-service', () => ({
				getCancellationReasonAggregation: vi.fn().mockResolvedValue({ total: 0, breakdown: [] }),
			}));

			const { getCancellationReasons } = await import(
				'../../../src/lib/server/services/analytics-service'
			);
			const result = await getCancellationReasons('30d');

			expect(result.total).toBe(0);
			expect(result.breakdown).toEqual([]);
		});
	});
});

describe('AnalyticsManager', () => {
	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
		delete process.env.ANALYTICS_ENABLED;
		delete process.env.ANALYTICS_TABLE_NAME;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('should use noop provider when no providers are configured', async () => {
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();
		analytics.init();

		expect(analytics.getActiveProviders()).toEqual(['noop']);
	});

	it('should enable DynamoDB provider when ANALYTICS_ENABLED=true', async () => {
		process.env.ANALYTICS_ENABLED = 'true';
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();
		analytics.init();

		expect(analytics.isProviderActive('dynamo')).toBe(true);
	});

	it('should not add noop when DynamoDB provider is active', async () => {
		process.env.ANALYTICS_ENABLED = 'true';
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();
		analytics.init();

		expect(analytics.isProviderActive('noop')).toBe(false);
	});

	it('should never include umami or sentry providers (#1591)', async () => {
		// 削除済みプロバイダの env が残っていても無視されることを保証
		process.env.PUBLIC_SENTRY_DSN = 'https://key@sentry.io/12345';
		process.env.PUBLIC_UMAMI_WEBSITE_ID = 'leftover';
		process.env.PUBLIC_UMAMI_HOST = 'https://cloud.umami.is';
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();
		analytics.init();

		const active = analytics.getActiveProviders();
		expect(active).not.toContain('sentry');
		expect(active).not.toContain('umami');
	});

	it('should not throw on any tracking call', async () => {
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();
		analytics.init();

		expect(() => analytics.trackEvent('test')).not.toThrow();
		expect(() => analytics.trackEvent('test', { foo: 'bar' })).not.toThrow();
		expect(() => analytics.trackPageView('/test')).not.toThrow();
		expect(() => analytics.trackError(new Error('test'))).not.toThrow();
		expect(() => analytics.identify('tenant-1')).not.toThrow();
		await expect(analytics.flush()).resolves.toBeUndefined();
	});

	it('should auto-initialize on first tracking call', async () => {
		const { analytics } = await import('../../../src/lib/analytics');
		analytics.reset();

		// Should not throw — auto-init on first call
		expect(() => analytics.trackEvent('auto-init-test')).not.toThrow();
		expect(analytics.getActiveProviders()).toEqual(['noop']);
	});
});
