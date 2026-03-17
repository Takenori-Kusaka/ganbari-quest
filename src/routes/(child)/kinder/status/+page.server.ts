import { findWeekEvaluation, hasDecayRunToday } from '$lib/server/db/evaluation-repo';
import { logger } from '$lib/server/logger';
import {
	evaluateChild,
	getWeekRange,
	runDailyDecay,
} from '$lib/server/services/evaluation-service';
import { getChildStatus } from '$lib/server/services/status-service';
import { checkAndUnlockTitles } from '$lib/server/services/title-service';
import type { PageServerLoad } from './$types';

/** 今日の日付文字列 (YYYY-MM-DD) */
function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}

/** ステータスページ表示時に、未実行の評価を自動実行する */
function ensureStatusUpToDate(childId: number) {
	const today = todayStr();

	// 日次衰退: 同じ日に既に実行済みかチェック
	if (!hasDecayRunToday(childId, today)) {
		runDailyDecay(today);
	}

	// 先週分の週次評価が未実行なら実行
	const { weekStart, weekEnd } = getWeekRange(new Date());
	const existing = findWeekEvaluation(childId, weekStart);

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
		logger.warn('[kinder/status] ステータス取得フォールバック', {
			context: { childId: child.id, error: result.error },
		});
		return { status: null };
	}

	// 偏差値ベースの称号チェック（ステータスページ表示時のみ）
	checkAndUnlockTitles(child.id);

	return { status: result };
};
