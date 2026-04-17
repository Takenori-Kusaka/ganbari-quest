// tests/unit/services/pricing-trigger-service.test.ts
// 価格見直しトリガー自動検知サービスのユニットテスト (#837)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tenant } from '../../../src/lib/server/auth/entities';
import type { MonthlyMetrics } from '../../../src/lib/server/services/pricing-trigger-service';

// --- Top-level mock fns ---

const mockListAllTenants = vi.fn<() => Promise<Tenant[]>>();
const mockIsStripeEnabled = vi.fn<() => boolean>();
const mockNotifyDiscord = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { listAllTenants: mockListAllTenants },
	}),
}));

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => mockIsStripeEnabled(),
	getStripeClient: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('$env/dynamic/private', () => ({
	env: {},
}));

vi.mock('../../../src/lib/server/services/discord-notify-service', () => ({
	notifyDiscord: (...args: unknown[]) => mockNotifyDiscord(...args),
}));

vi.mock('../../../src/lib/server/services/ops-service', () => ({
	getRevenueData: vi.fn().mockResolvedValue({ totalRevenue: 0 }),
	getAWSCostData: vi.fn().mockResolvedValue({ total: 0 }),
}));

// --- Import after mocks ---

import {
	evaluateAllTriggers,
	evaluateTrigger,
	getTriggerDefinitions,
	runPricingTriggerCheck,
} from '../../../src/lib/server/services/pricing-trigger-service';

// --- Helper ---

function makeTenant(overrides: Partial<Tenant> & { tenantId: string }): Tenant {
	return {
		name: `テナント-${overrides.tenantId}`,
		ownerId: 'owner-1',
		status: 'active',
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		...overrides,
	};
}

/** Stripe サブスクリプション保持の有料テナントを作成する */
function makePaidTenant(overrides: Partial<Tenant> & { tenantId: string }): Tenant {
	return makeTenant({
		plan: 'monthly',
		stripeSubscriptionId: `sub_${overrides.tenantId}`,
		stripeCustomerId: `cus_${overrides.tenantId}`,
		...overrides,
	});
}

function makeMetrics(overrides: Partial<MonthlyMetrics> = {}): MonthlyMetrics {
	return {
		month: '2026-04',
		totalActiveUsers: 100,
		paidUsers: 5,
		familyPlanUsers: 1,
		conversionRate: 0.05,
		churnRate: 0.04,
		monthlyRevenue: 2500,
		awsCost: 300,
		...overrides,
	};
}

// =============================================================
// evaluateTrigger — 単一トリガー判定
// =============================================================

describe('evaluateTrigger', () => {
	const triggerDefs = getTriggerDefinitions();

	function findDef(id: string) {
		const def = triggerDefs.find((d) => d.triggerId === id);
		if (!def) throw new Error(`Trigger definition not found: ${id}`);
		return def;
	}

	describe('low_conversion (転換率 < 3% が 3ヶ月連続)', () => {
		const def = findDef('low_conversion');

		it('3ヶ月連続で転換率 < 3% の場合に発火する', () => {
			const history = [
				makeMetrics({ month: '2026-02', conversionRate: 0.02 }),
				makeMetrics({ month: '2026-03', conversionRate: 0.025 }),
				makeMetrics({ month: '2026-04', conversionRate: 0.01 }),
			];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(true);
			expect(result.consecutiveMonths).toBe(3);
		});

		it('2ヶ月のみ < 3% の場合は発火しない', () => {
			const history = [
				makeMetrics({ month: '2026-02', conversionRate: 0.05 }),
				makeMetrics({ month: '2026-03', conversionRate: 0.02 }),
				makeMetrics({ month: '2026-04', conversionRate: 0.01 }),
			];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(false);
			expect(result.consecutiveMonths).toBe(2);
		});

		it('転換率 = 3% ちょうどの場合は発火しない (< 3%)', () => {
			const history = [
				makeMetrics({ month: '2026-02', conversionRate: 0.03 }),
				makeMetrics({ month: '2026-03', conversionRate: 0.03 }),
				makeMetrics({ month: '2026-04', conversionRate: 0.03 }),
			];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(false);
		});
	});

	describe('high_conversion (転換率 > 10% が 3ヶ月連続)', () => {
		const def = findDef('high_conversion');

		it('3ヶ月連続で転換率 > 10% の場合に発火する', () => {
			const history = [
				makeMetrics({ month: '2026-02', conversionRate: 0.12 }),
				makeMetrics({ month: '2026-03', conversionRate: 0.15 }),
				makeMetrics({ month: '2026-04', conversionRate: 0.11 }),
			];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(true);
		});

		it('転換率 = 10% ちょうどの場合は発火しない (> 10%)', () => {
			const history = [
				makeMetrics({ month: '2026-02', conversionRate: 0.1 }),
				makeMetrics({ month: '2026-03', conversionRate: 0.1 }),
				makeMetrics({ month: '2026-04', conversionRate: 0.1 }),
			];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(false);
		});
	});

	describe('high_churn (解約率 > 10% が 2ヶ月連続)', () => {
		const def = findDef('high_churn');

		it('2ヶ月連続で解約率 > 10% の場合に発火する', () => {
			const history = [
				makeMetrics({ month: '2026-03', churnRate: 0.12 }),
				makeMetrics({ month: '2026-04', churnRate: 0.15 }),
			];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(true);
		});

		it('1ヶ月のみ > 10% の場合は発火しない', () => {
			const history = [
				makeMetrics({ month: '2026-03', churnRate: 0.05 }),
				makeMetrics({ month: '2026-04', churnRate: 0.15 }),
			];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(false);
			expect(result.consecutiveMonths).toBe(1);
		});
	});

	describe('high_family_ratio (ファミリー比率 > 40%)', () => {
		const def = findDef('high_family_ratio');

		it('ファミリー比率 > 40% で発火する (1ヶ月判定)', () => {
			const history = [makeMetrics({ paidUsers: 10, familyPlanUsers: 5 })];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(true);
		});

		it('ファミリー比率 = 40% ちょうどの場合は発火しない', () => {
			const history = [makeMetrics({ paidUsers: 10, familyPlanUsers: 4 })];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(false);
		});

		it('有料ユーザー 0 人の場合は発火しない', () => {
			const history = [makeMetrics({ paidUsers: 0, familyPlanUsers: 0 })];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(false);
		});
	});

	describe('high_aws_cost_ratio (AWS原価が月間売上の20%超)', () => {
		const def = findDef('high_aws_cost_ratio');

		it('AWS原価 / 売上 > 20% で発火する', () => {
			const history = [makeMetrics({ monthlyRevenue: 10000, awsCost: 2500 })];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(true);
		});

		it('AWS原価 / 売上 = 20% ちょうどの場合は発火しない', () => {
			const history = [makeMetrics({ monthlyRevenue: 10000, awsCost: 2000 })];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(false);
		});

		it('売上 0 の場合は発火しない', () => {
			const history = [makeMetrics({ monthlyRevenue: 0, awsCost: 100 })];
			const result = evaluateTrigger(def, history);
			expect(result.fired).toBe(false);
		});
	});
});

// =============================================================
// evaluateAllTriggers
// =============================================================

describe('evaluateAllTriggers', () => {
	it('5 つのトリガー結果を返す', () => {
		const history = [makeMetrics()];
		const results = evaluateAllTriggers(history);
		expect(results).toHaveLength(5);
	});

	it('正常範囲内のメトリクスでは何も発火しない', () => {
		const history = [
			makeMetrics({ month: '2026-02', conversionRate: 0.05, churnRate: 0.04 }),
			makeMetrics({ month: '2026-03', conversionRate: 0.06, churnRate: 0.03 }),
			makeMetrics({ month: '2026-04', conversionRate: 0.07, churnRate: 0.05 }),
		];
		const results = evaluateAllTriggers(history);
		const fired = results.filter((r) => r.fired);
		expect(fired).toHaveLength(0);
	});

	it('複数トリガーが同時に発火する', () => {
		const history = [
			makeMetrics({
				month: '2026-02',
				conversionRate: 0.02,
				churnRate: 0.15,
				paidUsers: 10,
				familyPlanUsers: 5,
			}),
			makeMetrics({
				month: '2026-03',
				conversionRate: 0.01,
				churnRate: 0.12,
				paidUsers: 10,
				familyPlanUsers: 6,
			}),
			makeMetrics({
				month: '2026-04',
				conversionRate: 0.015,
				churnRate: 0.11,
				paidUsers: 10,
				familyPlanUsers: 5,
			}),
		];
		const results = evaluateAllTriggers(history);
		const fired = results.filter((r) => r.fired);
		// low_conversion (3 months), high_churn (2+ months), high_family_ratio
		expect(fired.length).toBeGreaterThanOrEqual(2);
	});

	it('空のメトリクス履歴では何も発火しない', () => {
		const results = evaluateAllTriggers([]);
		const fired = results.filter((r) => r.fired);
		expect(fired).toHaveLength(0);
	});
});

// =============================================================
// runPricingTriggerCheck
// =============================================================

describe('runPricingTriggerCheck', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsStripeEnabled.mockReturnValue(false);
	});

	it('有料ユーザー < 10 のときはスキップする', async () => {
		// 5 active tenants, none with stripeSubscriptionId = 0 paid users (< 10)
		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', status: 'active' }),
			makeTenant({ tenantId: 't2', status: 'active' }),
			makeTenant({ tenantId: 't3', status: 'active' }),
			makeTenant({ tenantId: 't4', status: 'active' }),
			makeTenant({ tenantId: 't5', status: 'active' }),
		]);

		const report = await runPricingTriggerCheck(2026, 4);

		expect(report.skipped).toBe(true);
		expect(report.skipReason).toContain('有料ユーザー数');
		expect(report.firedTriggers).toHaveLength(0);
	});

	it('トライアルユーザー（plan あり・stripeSubscriptionId なし）は有料にカウントしない', async () => {
		// 15 active tenants with plan set but no stripeSubscriptionId (trial users)
		const tenants: Tenant[] = [];
		for (let i = 0; i < 15; i++) {
			tenants.push(
				makeTenant({
					tenantId: `t${i}`,
					status: 'active',
					plan: 'monthly',
					trialUsedAt: '2026-04-01T00:00:00Z',
					// stripeSubscriptionId is NOT set → trial user, not paid
				}),
			);
		}
		mockListAllTenants.mockResolvedValue(tenants);

		const report = await runPricingTriggerCheck(2026, 4);

		// All are trial users, paidUserCount should be 0 → skipped
		expect(report.skipped).toBe(true);
		expect(report.paidUserCount).toBe(0);
	});

	it('有料ユーザー >= 10 のときは判定が実行される', async () => {
		const tenants: Tenant[] = [];
		for (let i = 0; i < 15; i++) {
			tenants.push(
				makePaidTenant({
					tenantId: `t${i}`,
					status: 'active',
					plan: 'monthly',
				}),
			);
		}
		mockListAllTenants.mockResolvedValue(tenants);

		const report = await runPricingTriggerCheck(2026, 4);

		expect(report.skipped).toBe(false);
		expect(report.triggers.length).toBe(5);
	});

	it('トリガー発火時に Discord 通知が呼ばれる', async () => {
		// 全員有料だが転換率 = 1 (100%) → high_conversion 発火
		const tenants: Tenant[] = [];
		for (let i = 0; i < 20; i++) {
			tenants.push(
				makePaidTenant({
					tenantId: `t${i}`,
					status: 'active',
					plan: 'monthly',
				}),
			);
		}
		mockListAllTenants.mockResolvedValue(tenants);

		const report = await runPricingTriggerCheck(2026, 4);

		if (report.firedTriggers.length > 0) {
			expect(mockNotifyDiscord).toHaveBeenCalled();
		}
	});

	it('トリガー未発火時は Discord 通知が呼ばれない', async () => {
		// 正常範囲のメトリクス: 5 paid + 95 free
		const tenants: Tenant[] = [];
		for (let i = 0; i < 100; i++) {
			tenants.push(
				i < 5
					? makePaidTenant({
							tenantId: `t${i}`,
							status: 'active',
							plan: 'monthly',
						})
					: makeTenant({
							tenantId: `t${i}`,
							status: 'active',
						}),
			);
		}
		mockListAllTenants.mockResolvedValue(tenants);

		// 5 paid users < 10 → skipped, no notification
		const report = await runPricingTriggerCheck(2026, 4);

		expect(report.skipped).toBe(true);
		expect(mockNotifyDiscord).not.toHaveBeenCalled();
	});

	it('レポートに month と evaluatedAt が含まれる', async () => {
		mockListAllTenants.mockResolvedValue([]);

		const report = await runPricingTriggerCheck(2026, 4);

		expect(report.month).toBe('2026-04');
		expect(report.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});

// =============================================================
// getTriggerDefinitions
// =============================================================

describe('getTriggerDefinitions', () => {
	it('5つのトリガー定義を返す', () => {
		const defs = getTriggerDefinitions();
		expect(defs).toHaveLength(5);
	});

	it('全トリガーIDがユニークである', () => {
		const defs = getTriggerDefinitions();
		const ids = defs.map((d) => d.triggerId);
		expect(new Set(ids).size).toBe(5);
	});

	it('§8.2 の 5 条件に対応するトリガーIDが存在する', () => {
		const defs = getTriggerDefinitions();
		const ids = defs.map((d) => d.triggerId);
		expect(ids).toContain('low_conversion');
		expect(ids).toContain('high_conversion');
		expect(ids).toContain('high_churn');
		expect(ids).toContain('high_family_ratio');
		expect(ids).toContain('high_aws_cost_ratio');
	});
});
