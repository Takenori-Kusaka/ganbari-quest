// tests/unit/services/analytics-ondemand-service.test.ts
// #3805: on-demand marketing 分析サービスのロジックテスト。
//
// repo (単一集約 SQL) は dsql-activation-funnel-repo.test.ts が PGlite 実データで検証する。
// 本テストは service 層の「件数 → 4 段 funnel step 組立 / 遷移率計算 / cancellation ラップ」を検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getActivationFunnelCounts, getCancellationReasonAggregation } = vi.hoisted(() => ({
	getActivationFunnelCounts: vi.fn(),
	getCancellationReasonAggregation: vi.fn(),
}));

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		activationFunnel: { getActivationFunnelCounts },
	}),
}));

vi.mock('$lib/server/services/cancellation-service', () => ({
	getCancellationReasonAggregation,
}));

import {
	getActivationFunnelOnDemand,
	getCancellationReasonsOnDemand,
} from '../../../src/lib/server/services/analytics-ondemand-service';

describe('analytics-ondemand-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getActivationFunnelOnDemand', () => {
		it('件数を 4 段 funnel step に組み立て、前段からの遷移率を計算する', async () => {
			getActivationFunnelCounts.mockResolvedValue({
				signupCount: 100,
				firstChildCount: 80,
				firstActivityCount: 60,
				retained7dCount: 30,
			});

			const result = await getActivationFunnelOnDemand('30d');

			expect(result.period).toBe('30d');
			expect(result.steps).toHaveLength(4);
			expect(result.steps.map((s) => s.eventName)).toEqual([
				'activation_signup_completed',
				'activation_first_child_added',
				'activation_first_activity_completed',
				'activation_retained_7d',
			]);
			expect(result.steps.map((s) => s.count)).toEqual([100, 80, 60, 30]);
			// Step 1 の遷移率は常に 1
			expect(result.steps[0]?.conversionFromPrev).toBe(1);
			// Step 2 = 80/100
			expect(result.steps[1]?.conversionFromPrev).toBeCloseTo(0.8);
			// Step 3 = 60/80
			expect(result.steps[2]?.conversionFromPrev).toBeCloseTo(0.75);
			// Step 4 (retention) = 30/60
			expect(result.steps[3]?.conversionFromPrev).toBeCloseTo(0.5);
		});

		it('④ は 7 日 retention 窓 (RETENTION_WINDOW_DAYS) で repo を呼ぶ', async () => {
			getActivationFunnelCounts.mockResolvedValue({
				signupCount: 0,
				firstChildCount: 0,
				firstActivityCount: 0,
				retained7dCount: 0,
			});

			await getActivationFunnelOnDemand('7d');

			expect(getActivationFunnelCounts).toHaveBeenCalledTimes(1);
			const [sinceIso, retentionDays] = getActivationFunnelCounts.mock.calls[0] ?? [];
			expect(retentionDays).toBe(7);
			// 7d 期間 → since は約 7 日前
			expect(typeof sinceIso).toBe('string');
			const diffDays = (Date.now() - new Date(sinceIso as string).getTime()) / 86_400_000;
			expect(diffDays).toBeGreaterThan(6.9);
			expect(diffDays).toBeLessThan(7.1);
		});

		it('前段が 0 のとき遷移率は 0 (ゼロ除算しない)', async () => {
			getActivationFunnelCounts.mockResolvedValue({
				signupCount: 0,
				firstChildCount: 0,
				firstActivityCount: 0,
				retained7dCount: 0,
			});

			const result = await getActivationFunnelOnDemand('30d');
			// Step 1 は count=0 でも conversion 1 (定義)、以降は prev=0 → 0
			expect(result.steps[0]?.conversionFromPrev).toBe(1);
			expect(result.steps[1]?.conversionFromPrev).toBe(0);
			expect(result.steps[3]?.conversionFromPrev).toBe(0);
		});
	});

	describe('getCancellationReasonsOnDemand', () => {
		it('cancellation_reasons 集計を DSQL main data から取得しラップする', async () => {
			getCancellationReasonAggregation.mockResolvedValue({
				total: 12,
				breakdown: [{ category: 'price', count: 12, percentage: 100 }],
			});

			const result = await getCancellationReasonsOnDemand('90d');

			expect(getCancellationReasonAggregation).toHaveBeenCalledWith(90);
			expect(result.period).toBe('90d');
			expect(result.total).toBe(12);
			expect(result.breakdown).toHaveLength(1);
		});

		it('30d 指定で 30 日窓を渡す', async () => {
			getCancellationReasonAggregation.mockResolvedValue({ total: 0, breakdown: [] });
			await getCancellationReasonsOnDemand('30d');
			expect(getCancellationReasonAggregation).toHaveBeenCalledWith(30);
		});
	});
});
