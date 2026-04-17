// tests/unit/services/stripe-metrics-service.test.ts
// Stripe 収益指標サービスのユニットテスト (#835)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tenant } from '../../../src/lib/server/auth/entities';

// --- Top-level mock fns ---

const mockListAllTenants = vi.fn<() => Promise<Tenant[]>>();
const mockIsStripeEnabled = vi.fn<() => boolean>();
const mockGetStripeClient = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { listAllTenants: mockListAllTenants },
	}),
}));

vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => mockIsStripeEnabled(),
	getStripeClient: () => mockGetStripeClient(),
}));

vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({
		monthly: {
			priceId: 'price_monthly',
			amount: 500,
			interval: 'month',
			tier: 'standard',
			label: '月額',
		},
		yearly: {
			priceId: 'price_yearly',
			amount: 5000,
			interval: 'year',
			tier: 'standard',
			label: '年額',
		},
		'family-monthly': {
			priceId: 'price_fm',
			amount: 780,
			interval: 'month',
			tier: 'family',
			label: 'ファミリー月額',
		},
		'family-yearly': {
			priceId: 'price_fy',
			amount: 7800,
			interval: 'year',
			tier: 'family',
			label: 'ファミリー年額',
		},
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// --- Import after mocks ---

import {
	calculateARPU,
	calculateMonthlyChurnRate,
	calculateMRR,
	calculateTrialToActiveRate,
	clearMetricsCache,
	countActivePaid,
	getStripeMetrics,
} from '../../../src/lib/server/services/stripe-metrics-service';

// --- Helper ---

function makeTenant(overrides: Partial<Tenant> & { tenantId: string }): Tenant {
	return {
		name: `テナント-${overrides.tenantId}`,
		ownerId: 'owner-1',
		status: 'active',
		createdAt: '2025-06-01T00:00:00Z',
		updatedAt: '2025-06-01T00:00:00Z',
		...overrides,
	};
}

// =============================================================
// calculateMRR
// =============================================================

describe('calculateMRR', () => {
	it('月額プランのテナントは額面がMRRに加算される', () => {
		const tenants = [
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly' }),
			makeTenant({ tenantId: 't2', status: 'active', plan: 'monthly' }),
		];
		expect(calculateMRR(tenants)).toBe(1000); // 500 * 2
	});

	it('年額プランは /12 で月次換算される', () => {
		const tenants = [makeTenant({ tenantId: 't1', status: 'active', plan: 'yearly' })];
		expect(calculateMRR(tenants)).toBe(Math.round(5000 / 12)); // 417
	});

	it('ファミリー月額・年額も正しく算出される', () => {
		const tenants = [
			makeTenant({ tenantId: 't1', status: 'active', plan: 'family-monthly' }),
			makeTenant({ tenantId: 't2', status: 'active', plan: 'family-yearly' }),
		];
		expect(calculateMRR(tenants)).toBe(780 + Math.round(7800 / 12));
	});

	it('非アクティブテナントはMRRに含まれない', () => {
		const tenants = [
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly' }),
			makeTenant({ tenantId: 't2', status: 'suspended', plan: 'monthly' }),
			makeTenant({ tenantId: 't3', status: 'terminated', plan: 'yearly' }),
		];
		expect(calculateMRR(tenants)).toBe(500);
	});

	it('planが未設定のテナントはMRRに含まれない', () => {
		const tenants = [makeTenant({ tenantId: 't1', status: 'active' })];
		expect(calculateMRR(tenants)).toBe(0);
	});

	it('テナント0件の場合はMRR=0', () => {
		expect(calculateMRR([])).toBe(0);
	});
});

// =============================================================
// calculateARPU
// =============================================================

describe('calculateARPU', () => {
	it('MRR / 有料数 で算出される', () => {
		expect(calculateARPU(3000, 6)).toBe(500);
	});

	it('有料ユーザー0人の場合は0を返す', () => {
		expect(calculateARPU(1000, 0)).toBe(0);
	});

	it('端数は四捨五入される', () => {
		expect(calculateARPU(1000, 3)).toBe(Math.round(1000 / 3));
	});
});

// =============================================================
// countActivePaid
// =============================================================

describe('countActivePaid', () => {
	it('アクティブかつプラン設定済みのテナントをカウント', () => {
		const tenants = [
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly' }),
			makeTenant({ tenantId: 't2', status: 'active', plan: 'yearly' }),
			makeTenant({ tenantId: 't3', status: 'active' }), // no plan
			makeTenant({ tenantId: 't4', status: 'suspended', plan: 'monthly' }),
		];
		expect(countActivePaid(tenants)).toBe(2);
	});

	it('lifetime プランは有料サブスクから除外される', () => {
		const tenants = [
			makeTenant({ tenantId: 't1', status: 'active', plan: 'lifetime' }),
			makeTenant({ tenantId: 't2', status: 'active', plan: 'monthly' }),
		];
		expect(countActivePaid(tenants)).toBe(1);
	});

	it('テナント0件の場合は0', () => {
		expect(countActivePaid([])).toBe(0);
	});
});

// =============================================================
// calculateTrialToActiveRate
// =============================================================

describe('calculateTrialToActiveRate', () => {
	it('過去N日以内にトライアルを使用し有料化したテナントの割合を返す', () => {
		const now = Date.now();
		const recentDate = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10日前

		const tenants = [
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly', trialUsedAt: recentDate }),
			makeTenant({ tenantId: 't2', status: 'active', plan: 'yearly', trialUsedAt: recentDate }),
			makeTenant({ tenantId: 't3', status: 'active', trialUsedAt: recentDate }), // plan なし → 未転換
			makeTenant({ tenantId: 't4', status: 'suspended', plan: 'monthly', trialUsedAt: recentDate }), // suspended → 未転換
		];
		// 4 人中 2 人転換
		expect(calculateTrialToActiveRate(tenants, 90)).toBe(0.5);
	});

	it('トライアル使用者がいない場合は0を返す', () => {
		const tenants = [makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly' })];
		expect(calculateTrialToActiveRate(tenants, 90)).toBe(0);
	});

	it('期間外のトライアルは除外される', () => {
		const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

		const tenants = [
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly', trialUsedAt: oldDate }),
		];
		expect(calculateTrialToActiveRate(tenants, 30)).toBe(0);
	});
});

// =============================================================
// calculateMonthlyChurnRate
// =============================================================

describe('calculateMonthlyChurnRate', () => {
	it('対象月に terminated になったテナント / 月初アクティブ数 を返す', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'terminated',
				createdAt: '2025-01-01T00:00:00Z',
				updatedAt: '2026-03-15T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't2',
				status: 'active',
				createdAt: '2025-01-01T00:00:00Z',
				updatedAt: '2025-01-01T00:00:00Z',
			}),
			makeTenant({
				tenantId: 't3',
				status: 'active',
				createdAt: '2025-01-01T00:00:00Z',
				updatedAt: '2025-01-01T00:00:00Z',
			}),
		];
		// 月初 3 人 (t1 は月内 terminated なので月初カウント), 解約 1 人
		const rate = calculateMonthlyChurnRate(tenants, '2026-03');
		expect(rate).toBeCloseTo(1 / 3, 2);
	});

	it('月初アクティブがいない場合は0を返す', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				createdAt: '2026-04-05T00:00:00Z', // 月内作成
			}),
		];
		expect(calculateMonthlyChurnRate(tenants, '2026-04')).toBe(0);
	});

	it('解約者がいない場合は0を返す', () => {
		const tenants = [
			makeTenant({
				tenantId: 't1',
				status: 'active',
				createdAt: '2025-01-01T00:00:00Z',
			}),
		];
		expect(calculateMonthlyChurnRate(tenants, '2026-04')).toBe(0);
	});
});

// =============================================================
// getStripeMetrics (integration-like)
// =============================================================

describe('getStripeMetrics', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearMetricsCache();
		// デフォルト: STRIPE_MOCK off
		vi.stubEnv('STRIPE_MOCK', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('STRIPE_MOCK=true の場合はモックデータを返す', async () => {
		vi.stubEnv('STRIPE_MOCK', 'true');

		const result = await getStripeMetrics();

		expect(result.current.isMock).toBe(true);
		expect(result.current.mrr).toBeGreaterThan(0);
		expect(result.trend.length).toBeGreaterThan(0);
	});

	it('Stripe無効の場合でもDB情報からMRR/ARR/ARPU等を算出する', async () => {
		mockIsStripeEnabled.mockReturnValue(false);
		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly' }),
			makeTenant({ tenantId: 't2', status: 'active', plan: 'monthly' }),
		]);

		const result = await getStripeMetrics();

		expect(result.current.mrr).toBe(1000);
		expect(result.current.arr).toBe(12000);
		expect(result.current.activePaidCount).toBe(2);
		expect(result.current.arpu).toBe(500);
		expect(result.current.isMock).toBe(false);
	});

	it('テナントがいない場合は全指標0', async () => {
		mockIsStripeEnabled.mockReturnValue(false);
		mockListAllTenants.mockResolvedValue([]);

		const result = await getStripeMetrics();

		expect(result.current.mrr).toBe(0);
		expect(result.current.arr).toBe(0);
		expect(result.current.arpu).toBe(0);
		expect(result.current.activePaidCount).toBe(0);
		expect(result.current.trialToActiveRate).toBe(0);
	});

	it('キャッシュが効く: 2回目の呼び出しではlistAllTenantsが再呼出されない', async () => {
		mockIsStripeEnabled.mockReturnValue(false);
		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't1', status: 'active', plan: 'monthly' }),
		]);

		await getStripeMetrics();
		await getStripeMetrics();

		expect(mockListAllTenants).toHaveBeenCalledTimes(1);
	});

	it('clearMetricsCache でキャッシュが無効化される', async () => {
		mockIsStripeEnabled.mockReturnValue(false);
		mockListAllTenants.mockResolvedValue([]);

		await getStripeMetrics();
		clearMetricsCache();
		await getStripeMetrics();

		expect(mockListAllTenants).toHaveBeenCalledTimes(2);
	});

	it('fetchedAt が ISO 文字列として設定される', async () => {
		mockIsStripeEnabled.mockReturnValue(false);
		mockListAllTenants.mockResolvedValue([]);

		const result = await getStripeMetrics();

		expect(result.current.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('trend が6か月分のデータを含む', async () => {
		mockIsStripeEnabled.mockReturnValue(false);
		mockListAllTenants.mockResolvedValue([]);

		const result = await getStripeMetrics();

		expect(result.trend).toHaveLength(6);
	});
});
