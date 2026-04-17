// tests/unit/services/ops-analytics-service.test.ts
// OPS 分析サービスのユニットテスト (#822)

import { describe, expect, it } from 'vitest';
import type { Tenant } from '../../../src/lib/server/auth/entities';
import {
	computeAnalytics,
	getMonthKey,
	monthDiff,
} from '../../../src/lib/server/services/ops-analytics-service';

// --- Helper: Tenant factory ---

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

// =============================================================
// getMonthKey
// =============================================================

describe('getMonthKey', () => {
	it('Date オブジェクトから YYYY-MM を返す', () => {
		expect(getMonthKey(new Date(2026, 3, 17))).toBe('2026-04');
	});

	it('ISO 文字列から YYYY-MM を返す', () => {
		expect(getMonthKey('2026-01-15T10:00:00Z')).toBe('2026-01');
	});

	it('月が 1 桁の場合ゼロ埋めされる', () => {
		expect(getMonthKey(new Date(2026, 0, 1))).toBe('2026-01');
	});
});

// =============================================================
// monthDiff
// =============================================================

describe('monthDiff', () => {
	it('同月は 0', () => {
		expect(monthDiff('2026-04', '2026-04')).toBe(0);
	});

	it('1 ヶ月差は 1', () => {
		expect(monthDiff('2026-03', '2026-04')).toBe(1);
	});

	it('年をまたぐ差を正しく計算する', () => {
		expect(monthDiff('2025-11', '2026-02')).toBe(3);
	});
});

// =============================================================
// computeAnalytics
// =============================================================

describe('computeAnalytics', () => {
	const now = new Date(2026, 3, 17); // 2026-04-17

	it('テナント 0 件の場合、全値が 0 / 空', () => {
		const result = computeAnalytics([], now);

		expect(result.ltv.estimatedLtv).toBe(0);
		expect(result.ltv.monthlyArpu).toBe(0);
		expect(result.ltv.activeSubscribers).toBe(0);
		expect(result.ltv.churned).toBe(0);
		expect(result.ltv.churnRate).toBe(0);
		expect(result.planBreakdown).toEqual([]);
		expect(result.monthlyAcquisitions).toHaveLength(12);
		expect(result.cohorts).toEqual([]);
	});

	it('MRR に family-monthly と family-yearly が含まれる', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'active',
				plan: 'family-monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't3',
				status: 'active',
				plan: 'family-yearly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
		];

		const result = computeAnalytics(tenants, now);

		// monthly: 500, family-monthly: 780, family-yearly: round(7800/12) = 650
		const expectedTotalMrr = 500 + 780 + Math.round(7800 / 12);
		const totalMrr = result.planBreakdown.reduce((sum, pb) => sum + pb.mrr, 0);
		expect(totalMrr).toBe(expectedTotalMrr);
	});

	it('planBreakdown に全プラン種別が含まれる', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'active',
				plan: 'yearly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't3',
				status: 'active',
				plan: 'family-monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't4',
				status: 'active',
				plan: 'family-yearly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't5',
				status: 'active',
				plan: 'lifetime',
				createdAt: '2026-04-01T00:00:00Z',
			}),
		];

		const result = computeAnalytics(tenants, now);

		const plans = result.planBreakdown.map((pb) => pb.plan).sort();
		expect(plans).toContain('monthly');
		expect(plans).toContain('yearly');
		expect(plans).toContain('family-monthly');
		expect(plans).toContain('family-yearly');
		expect(plans).toContain('lifetime');
	});

	it('suspended / terminated テナントは MRR に含まれない', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'suspended',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't3',
				status: 'terminated',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
		];

		const result = computeAnalytics(tenants, now);

		const totalMrr = result.planBreakdown.reduce((sum, pb) => sum + pb.mrr, 0);
		expect(totalMrr).toBe(500); // Only 1 active tenant
	});

	it('LTV = ARPU x avgLifetimeMonths', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
		];

		const result = computeAnalytics(tenants, now);

		// No churn → avgLifetimeMonths = 60 (上限)
		expect(result.ltv.avgLifetimeMonths).toBe(60);
		expect(result.ltv.monthlyArpu).toBe(500);
		expect(result.ltv.estimatedLtv).toBe(500 * 60);
	});

	it('churnRate が正しく計算される', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				plan: 'monthly',
				createdAt: '2026-04-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'terminated',
				plan: 'monthly',
				createdAt: '2026-01-01T00:00:00Z',
			}),
		];

		const result = computeAnalytics(tenants, now);

		// churnRate = 1 churned / 2 total = 50%
		expect(result.ltv.churnRate).toBe(50);
		expect(result.ltv.churned).toBe(1);
	});

	it('monthlyAcquisitions は過去 12 ヶ月分を返す', () => {
		const result = computeAnalytics([], now);

		expect(result.monthlyAcquisitions).toHaveLength(12);
		// 最初の月は 12 ヶ月前
		expect(result.monthlyAcquisitions[0]?.month).toBe('2025-05');
		// 最後の月は現在月
		expect(result.monthlyAcquisitions[11]?.month).toBe('2026-04');
	});

	it('monthlyAcquisitions に createdAt ベースの集計が反映される', () => {
		const tenants = [
			makeTenant({ tenantId: 't1', status: 'active', createdAt: '2026-04-05T00:00:00Z' }),
			makeTenant({ tenantId: 't2', status: 'active', createdAt: '2026-04-10T00:00:00Z' }),
			makeTenant({ tenantId: 't3', status: 'active', createdAt: '2026-03-01T00:00:00Z' }),
		];

		const result = computeAnalytics(tenants, now);

		const april = result.monthlyAcquisitions.find((ma) => ma.month === '2026-04');
		expect(april?.total).toBe(2);

		const march = result.monthlyAcquisitions.find((ma) => ma.month === '2026-03');
		expect(march?.total).toBe(1);
	});
});
