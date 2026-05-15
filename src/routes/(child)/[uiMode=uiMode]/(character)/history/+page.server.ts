import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { todayDateJST, toJSTDateString } from '$lib/domain/date-utils';
import { requireTenantId } from '$lib/server/auth/factory';
import { type ActivityLogEntry, getActivityLogs } from '$lib/server/services/activity-log-service';
import { applyRetentionFilter, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { PageServerLoad } from './$types';

function getDateRange(period: string): { from: string; to: string } {
	const to = todayDateJST();

	if (period === 'today') {
		return { from: to, to };
	}

	if (period === 'month') {
		const from = new Date();
		from.setDate(from.getDate() - 30);
		return { from: toJSTDateString(from), to };
	}

	// Default: week
	const from = new Date();
	from.setDate(from.getDate() - 7);
	return { from: toJSTDateString(from), to };
}

export const load: PageServerLoad = async ({ parent, url, locals }) => {
	const { child } = await parent();
	if (!child)
		return { logs: [], summary: { totalCount: 0, totalPoints: 0, byCategory: {} }, period: 'week' };

	// ADR-0039 Phase 2 (#2097): デモ実行モード時は demo-service の in-memory data。
	// demo-service の DemoHistoryData は本番 ActivityLogEntry とフィールドが一部異なるため、
	// ここで本番 shape (categoryId / streakBonus / etc.) に変換する。
	if (locals.isDemo) {
		const { getDemoHistoryData } = await import('$lib/server/demo/demo-service');
		const { DEMO_ACTIVITIES } = await import('$lib/server/demo/demo-data');
		const demoHist = getDemoHistoryData(child.id);
		const logs: ActivityLogEntry[] = demoHist.logs.map((l) => {
			const act = DEMO_ACTIVITIES.find((a) => a.name === l.activityName);
			return {
				id: l.id,
				activityName: l.activityName,
				activityIcon: l.activityIcon,
				categoryId: act?.categoryId ?? 0,
				points: l.points,
				streakDays: l.streakDays,
				streakBonus: 0,
				recordedAt: l.recordedAt,
			};
		});
		const totalCount = logs.length;
		const totalPoints = logs.reduce((s, l) => s + l.points, 0);
		const byCategory: Record<number, { count: number; points: number }> = {};
		for (const l of logs) {
			const entry = byCategory[l.categoryId] ?? { count: 0, points: 0 };
			entry.count++;
			entry.points += l.points;
			byCategory[l.categoryId] = entry;
		}
		return {
			logs,
			summary: { totalCount, totalPoints, byCategory },
			period: url.searchParams.get('period') ?? 'week',
		};
	}

	const tenantId = requireTenantId(locals);
	const period = url.searchParams.get('period') ?? 'week';
	const dateRange = getDateRange(period);
	const planTier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
	);
	const filtered = applyRetentionFilter(planTier, dateRange);
	const result = await getActivityLogs(child.id, tenantId, filtered);

	return {
		logs: result.logs,
		summary: result.summary,
		period,
	};
};
