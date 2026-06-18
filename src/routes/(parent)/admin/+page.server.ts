import { fail } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
// #2295 (EPIC #2294 ①): season-event-repo / seasonal-content-service 削除済 (2026-05-19)
import { getSettings, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import { getAllChildren } from '$lib/server/services/child-service';
import { dismissOnboarding, getOnboardingProgress } from '$lib/server/services/onboarding-service';
import { isPaidTier } from '$lib/server/services/plan-limit-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getAllChildrenSimpleSummary } from '$lib/server/services/report-service';
import { getChildStatus } from '$lib/server/services/status-service';
import {
	getTodayUsageSummary,
	getWeeklyUsageSummary,
} from '$lib/server/services/usage-log-service';
import {
	getTenantValuePreview,
	type TenantValuePreview,
} from '$lib/server/services/value-preview-service';
import type { Actions, PageServerLoad } from './$types';

// #3088: admin landing の load を高速化するための独立ブロック helper 群。
// 各ブロックは children + tenantId のみ依存で相互独立のため、load 本体で Promise.all 並列実行する
// (従来は 6 ブロックを逐次 await + per-child で balance→status を逐次しており wall-clock が sum 加算
//  だった。並列化で max に短縮。クエリロジック自体は不変で機能回帰なし)。

type AdminChildren = Awaited<ReturnType<typeof getAllChildren>>;
type MonthlySummaries = Record<
	number,
	{ totalActivities: number; currentLevel: number; newAchievements: number }
>;
type TodayUsage = { childId: number; childName: string; durationMin: number }[];
type WeeklyUsage = {
	childId: number;
	childName: string;
	dailySummary: { date: string; durationMin: number }[];
}[];

/** 子供ごとの残高 + ステータス。per-child の balance/status も並列取得する (#3088)。 */
async function loadChildrenWithStatus(children: AdminChildren, tenantId: string) {
	return Promise.all(
		children.map(async (child) => {
			const [balance, status] = await Promise.all([
				getPointBalance(child.id, tenantId),
				getChildStatus(child.id, tenantId),
			]);
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
}

/** 今月の簡易サマリー (失敗時は空でフォールバック)。 */
async function loadMonthlySummaries(
	tenantId: string,
	yearMonth: string,
): Promise<MonthlySummaries> {
	try {
		const summaryMap = await getAllChildrenSimpleSummary(tenantId, yearMonth);
		return Object.fromEntries(summaryMap);
	} catch (e) {
		logger.warn('[admin] 月次サマリー取得フォールバック', { context: { error: String(e) } });
		return {};
	}
}

/** 有料プラン歓迎画面フラグ (トライアル中も有料扱い)。 */
async function loadPremiumWelcome(isPaid: boolean, tenantId: string): Promise<boolean> {
	if (!isPaid) return false;
	const welcomeSettings = await getSettings(['premium_welcome_shown'], tenantId);
	return welcomeSettings.premium_welcome_shown !== 'true';
}

/** #1292: 本日の子供ごとの使用時間サマリー (失敗時は空)。 */
async function loadTodayUsage(children: AdminChildren, tenantId: string): Promise<TodayUsage> {
	try {
		return await getTodayUsageSummary(
			tenantId,
			children.map((c) => ({ id: c.id, nickname: c.nickname })),
		);
	} catch (e) {
		logger.warn('[admin] 使用時間取得フォールバック', { context: { error: String(e) } });
		return [];
	}
}

/** #1576: 週次使用時間サマリー (失敗時は空)。 */
async function loadWeeklyUsage(children: AdminChildren, tenantId: string): Promise<WeeklyUsage> {
	try {
		return await Promise.all(
			children.map(async (child) => {
				const dailySummary = await getWeeklyUsageSummary(tenantId, child.id);
				return { childId: child.id, childName: child.nickname, dailySummary };
			}),
		);
	} catch (e) {
		logger.warn('[admin] 週次使用時間取得フォールバック', { context: { error: String(e) } });
		return [];
	}
}

/** #1600: 初月価値プレビュー (失敗時は null = preview セクション非表示)。 */
async function loadValuePreview(tenantId: string): Promise<TenantValuePreview | null> {
	try {
		return await getTenantValuePreview(tenantId);
	} catch (e) {
		logger.warn('[admin] 価値プレビュー取得フォールバック', { context: { error: String(e) } });
		return null;
	}
}

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

	const now = new Date();
	const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	const isPaid = isPaidTier(tier);

	// #3088: 以降の 6 ブロックは children + tenantId のみ依存で相互独立 → 並列実行して wall-clock を短縮。
	// #2295: 季節コンテンツ / 思い出チケット削除済。#3033: planStats は /admin/subscription に一本化。
	const [
		childrenWithStatus,
		monthlySummaries,
		showPremiumWelcome,
		todayUsage,
		weeklyUsage,
		valuePreview,
	] = await Promise.all([
		loadChildrenWithStatus(children, tenantId),
		loadMonthlySummaries(tenantId, yearMonth),
		loadPremiumWelcome(isPaid, tenantId),
		loadTodayUsage(children, tenantId),
		loadWeeklyUsage(children, tenantId),
		loadValuePreview(tenantId),
	]);

	return {
		children: childrenWithStatus,
		onboarding,
		monthlySummaries,
		currentMonth: yearMonth,
		showPremiumWelcome,
		// #2295: seasonalInfo 削除済
		todayUsage,
		weeklyUsage,
		valuePreview,
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
