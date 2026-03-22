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

async function ensureStatusUpToDate(childId: number) {
	const today = todayStr();

	if (!(await hasDecayRunToday(childId, today))) {
		await runDailyDecay(today);
	}

	const { weekStart, weekEnd } = getWeekRange(new Date());
	const existing = await findWeekEvaluation(childId, weekStart);

	if (!existing) {
		await evaluateChild(childId, weekStart, weekEnd);
	}
}

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) return { status: null };

	await ensureStatusUpToDate(child.id);

	const result = await getChildStatus(child.id);
	if ('error' in result) {
		logger.warn('[baby/status] ステータス取得フォールバック', {
			context: { childId: child.id, error: result.error },
		});
		return { status: null };
	}

	return { status: result };
};
