import { requireTenantId } from '$lib/server/auth/factory';
import { findWeekEvaluation, hasDecayRunToday } from '$lib/server/db/evaluation-repo';
import { logger } from '$lib/server/logger';
import {
	evaluateChild,
	getWeekRange,
	runDailyDecay,
} from '$lib/server/services/evaluation-service';
import { getChildStatus } from '$lib/server/services/status-service';
import type { PageServerLoad } from './$types';

function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
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

	const result = await getChildStatus(child.id, tenantId);
	if ('error' in result) {
		logger.warn('[baby/status] ステータス取得フォールバック', {
			context: { childId: child.id, error: result.error },
		});
		return { status: null };
	}

	return { status: result };
};
