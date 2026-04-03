import { requireTenantId } from '$lib/server/auth/factory';
import { getSettings, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import { getActivities } from '$lib/server/services/activity-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { dismissOnboarding, getOnboardingProgress } from '$lib/server/services/onboarding-service';
import { getPlanLimits, resolvePlanTier } from '$lib/server/services/plan-limit-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getAllChildrenSimpleSummary } from '$lib/server/services/report-service';
import { getChildStatus } from '$lib/server/services/status-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	const [children, onboarding] = await Promise.all([
		getAllChildren(tenantId),
		getOnboardingProgress(tenantId, '/admin'),
	]);

	const childrenWithStatus = await Promise.all(
		children.map(async (child) => {
			const balance = await getPointBalance(child.id, tenantId);
			const status = await getChildStatus(child.id, tenantId);
			if ('error' in balance) {
				logger.warn('[admin] ポイント取得フォールバック', {
					context: { childId: child.id, error: balance.error },
				});
			}
			if ('error' in status) {
				logger.warn('[admin] ステータス取得フォールバック', {
					context: { childId: child.id, error: status.error },
				});
			}
			return {
				...child,
				balance: 'error' in balance ? 0 : balance.balance,
				level: 'error' in status ? 1 : status.level,
				levelTitle: 'error' in status ? '' : status.levelTitle,
			};
		}),
	);

	// 今月の簡易サマリー
	const now = new Date();
	const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	let monthlySummaries: Record<
		number,
		{ totalActivities: number; currentLevel: number; newAchievements: number }
	> = {};
	try {
		const summaryMap = await getAllChildrenSimpleSummary(tenantId, yearMonth);
		monthlySummaries = Object.fromEntries(summaryMap);
	} catch (e) {
		logger.warn('[admin] 月次サマリー取得フォールバック', { context: { error: String(e) } });
	}

	// プランステータスカード用データ
	let activityCount = 0;
	try {
		const acts = await getActivities(tenantId, { includeHidden: false });
		activityCount = acts.filter((a) => a.source === 'parent').length;
	} catch {
		/* fallback */
	}
	const tier = resolvePlanTier(locals.context?.licenseStatus ?? 'none', locals.context?.plan);
	const planLimits = getPlanLimits(tier);
	const planStats = {
		activityCount,
		activityMax: planLimits.maxActivities,
		childCount: children.length,
		childMax: planLimits.maxChildren,
		retentionDays: planLimits.historyRetentionDays,
	};

	// プレミアム歓迎画面フラグ
	const isPaid = tier !== 'free';
	let showPremiumWelcome = false;
	if (isPaid) {
		const welcomeSettings = await getSettings(['premium_welcome_shown'], tenantId);
		showPremiumWelcome = welcomeSettings.premium_welcome_shown !== 'true';
	}

	return {
		children: childrenWithStatus,
		onboarding,
		monthlySummaries,
		currentMonth: yearMonth,
		planStats,
		showPremiumWelcome,
	};
};

export const actions: Actions = {
	dismissOnboarding: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		try {
			await dismissOnboarding(tenantId);
			return { dismissed: true };
		} catch {
			return fail(500, { error: 'オンボーディングの非表示に失敗しました' });
		}
	},
	dismissPremiumWelcome: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		try {
			await setSetting('premium_welcome_shown', 'true', tenantId);
			return { dismissed: true };
		} catch {
			return fail(500, { error: 'プレミアム歓迎画面の非表示に失敗しました' });
		}
	},
};
