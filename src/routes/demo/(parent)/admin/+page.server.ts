import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import { getDemoPointBalance } from '$lib/server/demo/demo-data.js';
import { getDemoAdminData } from '$lib/server/demo/demo-service.js';
import { getPlanLimits, type PlanTier } from '$lib/server/services/plan-limit-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const adminData = getDemoAdminData();
	const children = adminData.children.map((child) => ({
		...child,
		balance: getDemoPointBalance(child.id),
		level: 1,
		levelTitle: '',
	}));

	// #760: プランはルート layout の demoPlan から取得（cookie/query の一元管理）
	const parentData = await parent();
	const planTier = parentData.demoPlan ?? 'free';
	const limits = getPlanLimits(planTier);

	// デモ用のプラン統計（固定値）。本番 /admin/license の planStats と同じ shape。
	const planStats = {
		activityCount: planTier === 'free' ? 3 : 6,
		activityMax: limits.maxActivities,
		childCount: children.length,
		childMax: limits.maxChildren,
		retentionDays: limits.historyRetentionDays,
	};

	// デモ用トライアル状態。free プランの時のみ「未開始」扱いで CTA を出す。
	// standard/family プランの時はトライアルは非アクティブ（既にアップグレード済みの想定）。
	const trialStatus = {
		isTrialActive: false,
		trialUsed: false,
		daysRemaining: 0,
		trialEndDate: null as string | null,
		trialTier: null as PlanTier | null,
	};

	return {
		children,
		pointSettings: DEFAULT_POINT_SETTINGS,
		planTier,
		planStats,
		trialStatus,
	};
};
