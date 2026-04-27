import { fail } from '@sveltejs/kit';
import { todayDateJST } from '$lib/domain/date-utils';
import { requireTenantId } from '$lib/server/auth/factory';
import { findActiveEvents } from '$lib/server/db/season-event-repo';
import { getSettings, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import { getActivities } from '$lib/server/services/activity-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { dismissOnboarding, getOnboardingProgress } from '$lib/server/services/onboarding-service';
import { getPlanLimits, isPaidTier } from '$lib/server/services/plan-limit-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getAllChildrenSimpleSummary } from '$lib/server/services/report-service';
import { getMemoryTicketStatus } from '$lib/server/services/seasonal-content-service';
import { getChildStatus } from '$lib/server/services/status-service';
import {
	getTodayUsageSummary,
	getWeeklyUsageSummary,
} from '$lib/server/services/usage-log-service';
import { isStripeEnabled } from '$lib/server/stripe/client';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const tenantId = requireTenantId(locals);

	// #726: 親 layout で解決済みの planTier をそのまま継承する。
	// ここで独自に resolvePlanTier を呼ぶとトライアル情報を渡し忘れ、
	// トライアル中でも free と判定される（歓迎画面が出ない）バグにつながる。
	const parentData = await parent();
	const tier = parentData.planTier;

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

	// 有料プラン歓迎画面フラグ（トライアル中も有料扱い）
	const isPaid = isPaidTier(tier);
	let showPremiumWelcome = false;
	if (isPaid) {
		const welcomeSettings = await getSettings(['premium_welcome_shown'], tenantId);
		showPremiumWelcome = welcomeSettings.premium_welcome_shown !== 'true';
	}

	// 季節コンテンツ情報（G6+G7: 思い出チケット＋管理表示）
	// イベント一覧を一度だけ取得し、seasonalInfo とシーズンパス両方で共有する
	const today = todayDateJST();
	let allActiveEvents: Awaited<ReturnType<typeof findActiveEvents>> = [];
	try {
		allActiveEvents = await findActiveEvents(today, tenantId);
	} catch {
		// イベント取得失敗はページに影響させない
	}

	let seasonalInfo: {
		activeEvents: {
			name: string;
			eventType: string;
			startDate: string;
			endDate: string;
			bannerIcon: string;
		}[];
		memoryTicket: Awaited<ReturnType<typeof getMemoryTicketStatus>> | null;
	} | null = null;
	try {
		const activeEvents = allActiveEvents.map((e) => ({
			name: e.name,
			eventType: e.eventType,
			startDate: e.startDate,
			endDate: e.endDate,
			bannerIcon: e.bannerIcon,
		}));

		let memoryTicket: Awaited<ReturnType<typeof getMemoryTicketStatus>> | null = null;
		if (isPaid) {
			const settings = await getSettings(['subscription_start_date'], tenantId);
			memoryTicket = await getMemoryTicketStatus(
				tenantId,
				settings.subscription_start_date ?? null,
			);
		}

		seasonalInfo = { activeEvents, memoryTicket };
	} catch {
		// 季節情報取得失敗はページに影響させない
	}

	// #767: ダッシュボードにプラン利用状況を表示
	const planLimits = getPlanLimits(tier);
	let activityCount = 0;
	try {
		const acts = await getActivities(tenantId, { includeHidden: false });
		activityCount = acts.filter((a) => a.source === 'parent').length;
	} catch {
		/* fallback */
	}
	const planStats = {
		activityCount,
		activityMax: planLimits.maxActivities,
		childCount: children.length,
		childMax: planLimits.maxChildren,
		retentionDays: planLimits.historyRetentionDays,
	};

	// #1292: 本日の子供ごとの使用時間サマリー
	let todayUsage: { childId: number; childName: string; durationMin: number }[] = [];
	try {
		todayUsage = await getTodayUsageSummary(
			tenantId,
			children.map((c) => ({ id: c.id, nickname: c.nickname })),
		);
	} catch (e) {
		logger.warn('[admin] 使用時間取得フォールバック', { context: { error: String(e) } });
	}

	// #1576: 週次使用時間サマリー（子供ごとの日別使用時間）
	let weeklyUsage: {
		childId: number;
		childName: string;
		dailySummary: { date: string; durationMin: number }[];
	}[] = [];
	try {
		const weeklyResults = await Promise.all(
			children.map(async (child) => {
				const dailySummary = await getWeeklyUsageSummary(tenantId, child.id);
				return { childId: child.id, childName: child.nickname, dailySummary };
			}),
		);
		weeklyUsage = weeklyResults;
	} catch (e) {
		logger.warn('[admin] 週次使用時間取得フォールバック', { context: { error: String(e) } });
	}

	return {
		children: childrenWithStatus,
		onboarding,
		monthlySummaries,
		currentMonth: yearMonth,
		showPremiumWelcome,
		seasonalInfo,
		planStats,
		stripeEnabled: isStripeEnabled(),
		todayUsage,
		weeklyUsage,
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
			return fail(500, { error: '歓迎画面の非表示に失敗しました' });
		}
	},
};
