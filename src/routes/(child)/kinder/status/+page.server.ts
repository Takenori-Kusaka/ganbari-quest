import { evaluateChild, getWeekRange, runDailyDecay } from '$lib/server/services/evaluation-service';
import { logger } from '$lib/server/logger';
import { getChildStatus } from '$lib/server/services/status-service';
import { db } from '$lib/server/db';
import { evaluations, statusHistory } from '$lib/server/db/schema';
import { and, eq, like } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

/** 今日の日付文字列 (YYYY-MM-DD) */
function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}

/** ステータスページ表示時に、未実行の評価を自動実行する */
function ensureStatusUpToDate(childId: number) {
	const today = todayStr();

	// 日次衰退: 同じ日に既に実行済みかチェック
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

	// 先週分の週次評価が未実行なら実行
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

	// ステータスを最新化
	ensureStatusUpToDate(child.id);

	const result = getChildStatus(child.id);
	if ('error' in result) {
		logger.warn('[kinder/status] ステータス取得フォールバック', { context: { childId: child.id, error: result.error } });
		return { status: null };
	}

	return { status: result };
};
