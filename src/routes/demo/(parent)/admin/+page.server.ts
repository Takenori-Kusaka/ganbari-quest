import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import { getDemoPointBalance } from '$lib/server/demo/demo-data.js';
import { getDemoAdminData } from '$lib/server/demo/demo-service.js';
import { getPlanLimits, type PlanTier } from '$lib/server/services/plan-limit-service';
import type { PageServerLoad } from './$types';

/**
 * デモ用プランティアを URL クエリから解決する (#791, #760 連動)。
 *
 * `?plan=free|standard|family` で切り替え可能。未指定時は `standard`（最も典型的なユースケース）。
 * これにより「プラン訴求」「有料機能」「無料制限」いずれもデモで体験できる。
 */
function resolveDemoPlanTier(url: URL): PlanTier {
	const param = url.searchParams.get('plan');
	if (param === 'free' || param === 'standard' || param === 'family') {
		return param;
	}
	return 'standard';
}

export const load: PageServerLoad = async ({ url }) => {
	const adminData = getDemoAdminData();
	const children = adminData.children.map((child) => ({
		...child,
		balance: getDemoPointBalance(child.id),
		level: 1,
		levelTitle: '',
	}));

	const planTier = resolveDemoPlanTier(url);
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
