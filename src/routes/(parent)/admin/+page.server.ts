import { fail } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { findActiveEvents } from '$lib/server/db/season-event-repo';
import { getSettings, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import { getAllChildren } from '$lib/server/services/child-service';
import { dismissOnboarding, getOnboardingProgress } from '$lib/server/services/onboarding-service';
import { resolvePlanTier } from '$lib/server/services/plan-limit-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getAllChildrenSimpleSummary } from '$lib/server/services/report-service';
import { getMemoryTicketStatus } from '$lib/server/services/seasonal-content-service';
import { getChildStatus } from '$lib/server/services/status-service';
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

	const tier = resolvePlanTier(locals.context?.licenseStatus ?? 'none', locals.context?.plan);

	// プレミアム歓迎画面フラグ
	const isPaid = tier !== 'free';
	let showPremiumWelcome = false;
	if (isPaid) {
		const welcomeSettings = await getSettings(['premium_welcome_shown'], tenantId);
		showPremiumWelcome = welcomeSettings.premium_welcome_shown !== 'true';
	}

	// 季節コンテンツ情報（G6+G7: 思い出チケット＋管理表示）
	// イベント一覧を一度だけ取得し、seasonalInfo とシーズンパス両方で共有する
	const today = new Date().toISOString().slice(0, 10);
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

	return {
		children: childrenWithStatus,
		onboarding,
		monthlySummaries,
		currentMonth: yearMonth,
		showPremiumWelcome,
		seasonalInfo,
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
