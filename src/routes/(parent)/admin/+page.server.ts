import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { getAllChildren } from '$lib/server/services/child-service';
import { dismissOnboarding, getOnboardingProgress } from '$lib/server/services/onboarding-service';
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

	return { children: childrenWithStatus, onboarding, monthlySummaries, currentMonth: yearMonth };
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
};
