import { evaluateChild, getWeekRange, runDailyDecay } from '$lib/server/services/evaluation-service';
import { getChildStatus } from '$lib/server/services/status-service';
import { db } from '$lib/server/db';
import { evaluations, statusHistory } from '$lib/server/db/schema';
import { and, eq, like } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}

function ensureStatusUpToDate(childId: number) {
	const today = todayStr();

	const decayAlreadyRun = db
		.select({ id: statusHistory.id })
		.from(statusHistory)
		.where(
			and(
				eq(statusHistory.childId, childId),
				eq(statusHistory.changeType, 'daily_decay'),
				like(statusHistory.recordedAt, `${today}%`),
			),
		)
		.get();

	if (!decayAlreadyRun) {
		runDailyDecay(today);
	}

	const { weekStart, weekEnd } = getWeekRange(new Date());
	const existing = db
		.select({ id: evaluations.id })
		.from(evaluations)
		.where(
			and(
				eq(evaluations.childId, childId),
				eq(evaluations.weekStart, weekStart),
			),
		)
		.get();

	if (!existing) {
		evaluateChild(childId, weekStart, weekEnd);
	}
}

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) return { status: null };

	ensureStatusUpToDate(child.id);

	const result = getChildStatus(child.id);
	if ('error' in result) return { status: null };

	return { status: result };
};
