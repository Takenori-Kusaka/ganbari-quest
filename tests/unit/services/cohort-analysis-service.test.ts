// tests/unit/services/cohort-analysis-service.test.ts
// コホート別 LTV / チャーン率推移サービスのユニットテスト (#838)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tenant } from '../../../src/lib/server/auth/entities';

// --- Top-level mock fns ---

const mockListAllTenants = vi.fn<() => Promise<Tenant[]>>();
const mockIsStripeEnabled = vi.fn<() => boolean>();

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

// --- Import after mocks ---

import {
	getCohortAnalysis,
	RETENTION_DAYS,
} from '../../../src/lib/server/services/cohort-analysis-service';

// --- Helper ---

function makeTenant(overrides: Partial<Tenant> & { tenantId: string }): Tenant {
	return {
		name: `テナント-${overrides.tenantId}`,
		ownerId: 'owner-1',
		status: 'active',
		createdAt: '2026-01-15T00:00:00Z',
		updatedAt: '2026-01-15T00:00:00Z',
		...overrides,
	};
}

/** 指定月の日付文字列を生成 */
function monthDate(yearMonth: string, day = 15): string {
	return `${yearMonth}-${String(day).padStart(2, '0')}T00:00:00Z`;
}

/** コホート配列から安全に先頭要素を取得 */
function firstCohort(cohorts: Awaited<ReturnType<typeof getCohortAnalysis>>['cohorts']) {
	const c = cohorts[0];
	if (!c) throw new Error('Expected at least one cohort');
	return c;
}

// =============================================================
// getCohortAnalysis
// =============================================================

describe('getCohortAnalysis', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsStripeEnabled.mockReturnValue(false);
	});

	it('テナントが 0 件の場合、空のコホートが返る', async () => {
		mockListAllTenants.mockResolvedValue([]);

		const result = await getCohortAnalysis(3);

		expect(result.cohorts).toHaveLength(3);
		expect(result.arpu).toBe(0);
		expect(result.monthlyChurnRate).toBe(0);
		expect(result.theoreticalLtv).toBe(0);
		expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('コホートがサインアップ月でグルーピングされる', async () => {
		const now = new Date();
		const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', createdAt: monthDate(thisMonth, 1) }),
			makeTenant({ tenantId: 't2', createdAt: monthDate(thisMonth, 10) }),
			makeTenant({ tenantId: 't3', createdAt: monthDate(thisMonth, 20) }),
		]);

		const result = await getCohortAnalysis(1);

		expect(result.cohorts).toHaveLength(1);
		const cohort = firstCohort(result.cohorts);
		expect(cohort.month).toBe(thisMonth);
		expect(cohort.size).toBe(3);
	});

	it('有料テナントの paidSize が正しく集計される', async () => {
		const now = new Date();
		const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't1',
				createdAt: monthDate(thisMonth),
				plan: 'monthly',
			}),
			makeTenant({
				tenantId: 't2',
				createdAt: monthDate(thisMonth),
				plan: 'family-monthly',
			}),
			makeTenant({
				tenantId: 't3',
				createdAt: monthDate(thisMonth),
			}),
		]);

		const result = await getCohortAnalysis(1);

		expect(firstCohort(result.cohorts).paidSize).toBe(2);
	});

	it('サンプル不足が正しく判定される（有料コホート < 10）', async () => {
		const now = new Date();
		const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		const tenants = [];
		for (let i = 0; i < 5; i++) {
			tenants.push(
				makeTenant({
					tenantId: `t${i}`,
					createdAt: monthDate(thisMonth),
					plan: 'monthly',
				}),
			);
		}
		mockListAllTenants.mockResolvedValue(tenants);

		const result = await getCohortAnalysis(1);

		expect(firstCohort(result.cohorts).insufficientSample).toBe(true);
	});

	it('十分なサンプルがある場合は insufficientSample = false', async () => {
		const now = new Date();
		const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		const tenants = [];
		for (let i = 0; i < 15; i++) {
			tenants.push(
				makeTenant({
					tenantId: `t${i}`,
					createdAt: monthDate(thisMonth),
					plan: 'monthly',
				}),
			);
		}
		mockListAllTenants.mockResolvedValue(tenants);

		const result = await getCohortAnalysis(1);

		expect(firstCohort(result.cohorts).insufficientSample).toBe(false);
	});

	it('ARPU が有料プラン単価の加重平均で計算される', async () => {
		const now = new Date();
		const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't1',
				createdAt: monthDate(thisMonth),
				plan: 'monthly',
				status: 'active',
			}),
			makeTenant({
				tenantId: 't2',
				createdAt: monthDate(thisMonth),
				plan: 'family-monthly',
				status: 'active',
			}),
		]);

		const result = await getCohortAnalysis(1);

		// ARPU = (500 + 780) / 2 = 640
		expect(result.arpu).toBe(640);
	});

	it('理論値 LTV = ARPU / 月次解約率 (§7.3)', async () => {
		const now = new Date();
		const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		// 10 active paid + 1 terminated this month
		const tenants = [];
		for (let i = 0; i < 10; i++) {
			tenants.push(
				makeTenant({
					tenantId: `t${i}`,
					createdAt: monthDate(thisMonth, 1),
					plan: 'monthly',
					status: 'active',
				}),
			);
		}
		tenants.push(
			makeTenant({
				tenantId: 'terminated',
				createdAt: monthDate(thisMonth, 1),
				plan: 'monthly',
				status: 'terminated',
				updatedAt: new Date().toISOString(), // terminated this month
			}),
		);
		mockListAllTenants.mockResolvedValue(tenants);

		const result = await getCohortAnalysis(1);

		// churnRate = 1/10 = 0.1
		// theoreticalLtv = 500 / 0.1 = 5000
		expect(result.monthlyChurnRate).toBe(0.1);
		expect(result.theoreticalLtv).toBe(5000);
	});

	it('解約率 0 の場合、理論値 LTV は 0 になる', async () => {
		const now = new Date();
		const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't1',
				createdAt: monthDate(thisMonth),
				plan: 'monthly',
				status: 'active',
			}),
		]);

		const result = await getCohortAnalysis(1);

		expect(result.monthlyChurnRate).toBe(0);
		expect(result.theoreticalLtv).toBe(0);
	});

	it('リテンションが Day N ごとに返される', async () => {
		const now = new Date();
		// 90日以上前のコホート
		const oldDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
		const oldMonth = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}`;

		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't1',
				createdAt: monthDate(oldMonth),
				status: 'active',
			}),
		]);

		// 6ヶ月分取得して、古いコホートが含まれるようにする
		const result = await getCohortAnalysis(6);

		const oldCohort = result.cohorts.find((c) => c.month === oldMonth);
		if (oldCohort) {
			// 90日以上前なので全 Day N が計算されるはず
			for (const dayN of RETENTION_DAYS) {
				expect(oldCohort.retention[dayN]).not.toBeNull();
			}
		}
	});

	it('まだ到来していない Day N は null', async () => {
		const now = new Date();
		const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		// 本日サインアップ
		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't1',
				createdAt: now.toISOString(),
				status: 'active',
			}),
		]);

		const result = await getCohortAnalysis(1);

		const cohort = result.cohorts.find((c) => c.month === thisMonth);
		if (cohort) {
			// Day 90 はまだ到来していない
			expect(cohort.retention[90]).toBeNull();
		}
	});

	it('コホートのない月は size=0 で返される', async () => {
		mockListAllTenants.mockResolvedValue([]);

		const result = await getCohortAnalysis(3);

		for (const cohort of result.cohorts) {
			expect(cohort.size).toBe(0);
			expect(cohort.paidSize).toBe(0);
		}
	});

	it('monthsBack パラメータでコホート数が変わる', async () => {
		mockListAllTenants.mockResolvedValue([]);

		const result3 = await getCohortAnalysis(3);
		const result6 = await getCohortAnalysis(6);

		expect(result3.cohorts).toHaveLength(3);
		expect(result6.cohorts).toHaveLength(6);
	});

	it('terminated テナントの Day N 前解約は retention に反映される', async () => {
		const now = new Date();
		// 60日前にサインアップ
		const signupDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
		const signupMonth = `${signupDate.getFullYear()}-${String(signupDate.getMonth() + 1).padStart(2, '0')}`;

		// 5日後に解約（Day 7 前）
		const terminatedDate = new Date(signupDate.getTime() + 5 * 24 * 60 * 60 * 1000);

		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't1',
				createdAt: signupDate.toISOString(),
				status: 'active',
			}),
			makeTenant({
				tenantId: 't2',
				createdAt: signupDate.toISOString(),
				status: 'terminated',
				updatedAt: terminatedDate.toISOString(),
			}),
		]);

		const result = await getCohortAnalysis(6);
		const cohort = result.cohorts.find((c) => c.month === signupMonth);

		if (cohort) {
			// Day 1: t2 はまだ active (terminated は 5日後) → 100%
			expect(cohort.retention[1]).toBe(1.0);
			// Day 7: t2 は 5日目に terminated → Day 7 以降は不在
			// t1 は active なので retained
			expect(cohort.retention[7]).toBe(0.5);
			// Day 30: 同様
			expect(cohort.retention[30]).toBe(0.5);
		}
	});
});

// =============================================================
// RETENTION_DAYS
// =============================================================

describe('RETENTION_DAYS', () => {
	it('6 つのリテンション計測ポイントが定義されている', () => {
		expect(RETENTION_DAYS).toHaveLength(6);
	});

	it('Day 1, 7, 14, 30, 60, 90 が含まれる', () => {
		expect([...RETENTION_DAYS]).toEqual([1, 7, 14, 30, 60, 90]);
	});
});
