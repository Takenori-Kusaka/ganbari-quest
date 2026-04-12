import { todayDateJST } from '$lib/domain/date-utils';
import { requireTenantId } from '$lib/server/auth/factory';
import { findWeekEvaluation, hasDecayRunToday } from '$lib/server/db/evaluation-repo';
import { logger } from '$lib/server/logger';
import {
	evaluateChild,
	getWeekRange,
	runDailyDecay,
} from '$lib/server/services/evaluation-service';
import { getChildStatus, getMonthlyComparison } from '$lib/server/services/status-service';
import type { PageServerLoad } from './$types';

function todayStr(): string {
	return todayDateJST();
}

async function ensureStatusUpToDate(childId: number, tenantId: string) {
	const today = todayStr();

	if (!(await hasDecayRunToday(childId, today, tenantId))) {
		await runDailyDecay(tenantId, today);
	}

	const { weekStart, weekEnd } = getWeekRange(new Date());
	const existing = await findWeekEvaluation(childId, weekStart, tenantId);

	if (!existing) {
		await evaluateChild(childId, weekStart, weekEnd, tenantId);
	}
}

export const load: PageServerLoad = async ({ parent, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { status: null };

	await ensureStatusUpToDate(child.id, tenantId);

	const [result, monthlyComparison] = await Promise.all([
		getChildStatus(child.id, tenantId),
		getMonthlyComparison(child.id, tenantId),
	]);
	if ('error' in result) {
		logger.warn('[status] ステータス取得フォールバック', {
			context: { childId: child.id, error: result.error },
		});
		return { status: null, monthlyComparison: null };
	}

	return { status: result, monthlyComparison };
};
