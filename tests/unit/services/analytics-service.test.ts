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
