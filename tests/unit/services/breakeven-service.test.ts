// tests/unit/services/breakeven-service.test.ts
// 損益分岐点分析サービスのユニットテスト (#836)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Top-level mock fns ---

const mockGetStripeMetrics = vi.fn();
const mockGetAWSCostData = vi.fn();

vi.mock('$lib/server/services/stripe-metrics-service', () => ({
	getStripeMetrics: () => mockGetStripeMetrics(),
}));

vi.mock('$lib/server/services/ops-service', () => ({
	getAWSCostData: (...args: unknown[]) => mockGetAWSCostData(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// --- Import after mocks ---

import {
	calculateBreakevenUsers,
	calculateFixedCosts,
	calculateMonthlyProfit,
	calculateProgressRate,
	calculateStripeFee,
	getBreakevenData,
	getCurrentScaleTier,
	SCALE_TIERS,
} from '../../../src/lib/server/services/breakeven-service';

// =============================================================
// calculateFixedCosts
// =============================================================

describe('calculateFixedCosts', () => {
	beforeEach(() => {
		vi.unstubAllEnvs();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('デフォルトではドメイン費 117 円のみ', () => {
		vi.stubEnv('OPS_DOMAIN_COST_JPY', '117');
		vi.stubEnv('OPS_VIRTUAL_OFFICE_COST_JPY', '0');

		const result = calculateFixedCosts();

		expect(result.total).toBe(117);
		expect(result.breakdown).toHaveLength(1);
		expect(result.breakdown[0]?.label).toBe('ドメイン費');
	});

	it('バーチャルオフィス費を含む場合は合算される', () => {
		vi.stubEnv('OPS_DOMAIN_COST_JPY', '117');
		vi.stubEnv('OPS_VIRTUAL_OFFICE_COST_JPY', '500');

		const result = calculateFixedCosts();

		expect(result.total).toBe(617);
		expect(result.breakdown).toHaveLength(2);
	});

	it('両方 0 の場合は空の breakdown で total=0', () => {
		vi.stubEnv('OPS_DOMAIN_COST_JPY', '0');
		vi.stubEnv('OPS_VIRTUAL_OFFICE_COST_JPY', '0');

		const result = calculateFixedCosts();

		expect(result.total).toBe(0);
		expect(result.breakdown).toHaveLength(0);
	});
});

// =============================================================
// calculateBreakevenUsers
// =============================================================

describe('calculateBreakevenUsers', () => {
	it('固定費117 + AWS0 の場合、BEP = ceil(117 / (500 * 0.964)) = 1', () => {
		const result = calculateBreakevenUsers(117, 0);
		expect(result).toBe(Math.ceil(117 / (500 * 0.964)));
	});

	it('固定費117 + AWS 518 (=$3.45*150) の場合', () => {
		const awsCostJpy = Math.round(3.45 * 150); // 518
		const result = calculateBreakevenUsers(117, awsCostJpy);
		expect(result).toBe(Math.ceil((117 + awsCostJpy) / (500 * 0.964)));
	});

	it('コストが高い場合はより多くのユーザーが必要', () => {
		const low = calculateBreakevenUsers(117, 0);
		const high = calculateBreakevenUsers(117, 10000);
		expect(high).toBeGreaterThan(low);
	});

	it('固定費+AWS費が0の場合は0ユーザー', () => {
		expect(calculateBreakevenUsers(0, 0)).toBe(0);
	});
});

// =============================================================
// calculateStripeFee
// =============================================================

describe('calculateStripeFee', () => {
	it('売上 x 3.6% で算出される', () => {
		expect(calculateStripeFee(10000)).toBe(Math.round(10000 * 0.036));
	});

	it('売上 0 の場合は 0', () => {
		expect(calculateStripeFee(0)).toBe(0);
	});

	it('端数は四捨五入される', () => {
		expect(calculateStripeFee(1000)).toBe(Math.round(1000 * 0.036));
	});
});

// =============================================================
// calculateMonthlyProfit
// =============================================================

describe('calculateMonthlyProfit', () => {
	it('売上 - AWS原価 - Stripe手数料 - 固定費 で算出される', () => {
		const result = calculateMonthlyProfit(3500, 518, 126, 117);
		expect(result).toBe(3500 - 518 - 126 - 117);
	});

	it('赤字の場合はマイナスを返す', () => {
		const result = calculateMonthlyProfit(500, 2000, 18, 117);
		expect(result).toBeLessThan(0);
	});

	it('全て 0 の場合は 0', () => {
		expect(calculateMonthlyProfit(0, 0, 0, 0)).toBe(0);
	});
});

// =============================================================
// calculateProgressRate
// =============================================================

describe('calculateProgressRate', () => {
	it('有料数 / BEPユーザー数 で算出される', () => {
		expect(calculateProgressRate(3, 6)).toBeCloseTo(0.5);
	});

	it('BEP達成の場合は 1.0', () => {
		expect(calculateProgressRate(6, 6)).toBe(1);
	});

	it('BEP超過の場合は 1.0 以上', () => {
		expect(calculateProgressRate(12, 6)).toBe(2);
	});

	it('BEPが0の場合: ユーザーあり → 1, ユーザーなし → 0', () => {
		expect(calculateProgressRate(5, 0)).toBe(1);
		expect(calculateProgressRate(0, 0)).toBe(0);
	});
});

// =============================================================
// getCurrentScaleTier
// =============================================================

describe('getCurrentScaleTier', () => {
	it('0 名は "最小" 帯', () => {
		const tier = getCurrentScaleTier(0);
		expect(tier.id).toBe('minimum');
	});

	it('2 名は "最小" 帯', () => {
		const tier = getCurrentScaleTier(2);
		expect(tier.id).toBe('minimum');
	});

	it('3 名は "小規模" 帯', () => {
		const tier = getCurrentScaleTier(3);
		expect(tier.id).toBe('small');
	});

	it('10 名は "小規模" 帯', () => {
		const tier = getCurrentScaleTier(10);
		expect(tier.id).toBe('small');
	});

	it('11 名は "中規模" 帯', () => {
		const tier = getCurrentScaleTier(11);
		expect(tier.id).toBe('medium');
	});

	it('51 名以上は "目標" 帯', () => {
		const tier = getCurrentScaleTier(51);
		expect(tier.id).toBe('target');
	});

	it('100 名は "目標" 帯', () => {
		const tier = getCurrentScaleTier(100);
		expect(tier.id).toBe('target');
	});
});

// =============================================================
// SCALE_TIERS
// =============================================================

describe('SCALE_TIERS', () => {
	it('4 つの規模帯が定義されている', () => {
		expect(SCALE_TIERS).toHaveLength(4);
	});

	it('最後の帯は maxUsers=null (上限なし)', () => {
		const last = SCALE_TIERS[SCALE_TIERS.length - 1];
		expect(last?.maxUsers).toBeNull();
	});
});

// =============================================================
// getBreakevenData (integration-like)
// =============================================================

describe('getBreakevenData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('STRIPE_MOCK=true の場合はモックデータを返す', async () => {
		vi.stubEnv('STRIPE_MOCK', 'true');

		const result = await getBreakevenData();

		expect(result.isMock).toBe(true);
		expect(result.monthlyRevenue).toBeGreaterThan(0);
		expect(result.breakevenUsers).toBeGreaterThan(0);
		expect(result.scaleTiers).toHaveLength(4);
	});

	it('正常系: Stripe + AWS データを統合して返す', async () => {
		vi.stubEnv('STRIPE_MOCK', '');
		vi.stubEnv('OPS_DOMAIN_COST_JPY', '117');
		vi.stubEnv('OPS_VIRTUAL_OFFICE_COST_JPY', '0');

		mockGetStripeMetrics.mockResolvedValue({
			current: {
				mrr: 3000,
				arr: 36000,
				arpu: 500,
				activePaidCount: 6,
				trialToActiveRate: 0.3,
				monthlyChurnRate: 0.05,
				monthlyRevenue: 3000,
				fetchedAt: new Date().toISOString(),
				isMock: false,
			},
			trend: [],
		});

		mockGetAWSCostData.mockResolvedValue({
			month: '2026-04',
			services: [{ service: 'AWS Lambda', amount: 2.0, unit: 'USD' }],
			total: 2.0,
			fetchedAt: new Date().toISOString(),
		});

		const result = await getBreakevenData();

		expect(result.isMock).toBe(false);
		expect(result.monthlyRevenue).toBe(3000);
		expect(result.awsCostUsd).toBe(2.0);
		expect(result.awsCostJpy).toBe(300); // 2.0 * 150
		expect(result.stripeFee).toBe(Math.round(3000 * 0.036));
		expect(result.fixedCosts).toBe(117);
		expect(result.currentPaidUsers).toBe(6);
		expect(result.breakevenUsers).toBeGreaterThan(0);
		expect(result.scaleTiers).toHaveLength(4);
		expect(result.currentScaleTier.id).toBe('small'); // 6 users = small
	});

	it('エラー発生時はフォールバックのモックデータを返す', async () => {
		vi.stubEnv('STRIPE_MOCK', '');

		mockGetStripeMetrics.mockRejectedValue(new Error('API failure'));
		mockGetAWSCostData.mockRejectedValue(new Error('Cost Explorer failure'));

		const result = await getBreakevenData();

		// フォールバック: モックデータ
		expect(result.isMock).toBe(true);
		expect(result.breakevenUsers).toBeGreaterThan(0);
	});

	it('progressRate は有料ユーザー / BEPユーザー', async () => {
		vi.stubEnv('STRIPE_MOCK', '');
		vi.stubEnv('OPS_DOMAIN_COST_JPY', '117');
		vi.stubEnv('OPS_VIRTUAL_OFFICE_COST_JPY', '0');

		mockGetStripeMetrics.mockResolvedValue({
			current: {
				mrr: 500,
				arr: 6000,
				arpu: 500,
				activePaidCount: 1,
				trialToActiveRate: 0,
				monthlyChurnRate: 0,
				monthlyRevenue: 500,
				fetchedAt: new Date().toISOString(),
				isMock: false,
			},
			trend: [],
		});

		mockGetAWSCostData.mockResolvedValue({
			month: '2026-04',
			services: [],
			total: 0,
			fetchedAt: new Date().toISOString(),
		});

		const result = await getBreakevenData();

		expect(result.currentPaidUsers).toBe(1);
		expect(result.breakevenUsers).toBeGreaterThan(0);
		expect(result.progressRate).toBe(result.currentPaidUsers / result.breakevenUsers);
	});
});
