// /demo/admin/license — デモ版プラン・お支払い画面 (#790)
// 本番 /admin/license の UI をミラーしつつ、Stripe/ライセンスサービスは全てモック化する。
// デモは認証レスなので tenant 情報は固定値。クリックしても Stripe には到達しない。

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// 本番 /admin/license が返す data 構造と同じ shape を返す。
	// プラン/ステータスはデモ用の固定値（free プラン・アクティブ）。
	return {
		license: {
			plan: 'free' as const,
			status: 'active' as const,
			tenantName: 'デモファミリー',
			createdAt: '2026-01-01T00:00:00Z',
			updatedAt: '2026-01-01T00:00:00Z',
		},
		// デモでは Stripe を無効化し、プラン選択は「デモでは実際の決済はできません」として表示する
		stripeEnabled: false,
		loyaltyInfo: null,
		planTier: 'free' as const,
		planStats: {
			activityCount: 6,
			activityMax: 10,
			childCount: 2,
			childMax: 3,
			retentionDays: 90,
		},
		trialStatus: {
			isTrialActive: false,
			trialUsed: false,
			daysRemaining: 0,
			trialEndDate: null,
			trialTier: null,
		},
	};
};
