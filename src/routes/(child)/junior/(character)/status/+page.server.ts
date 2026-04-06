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

/** 今日の日付文字列 (YYYY-MM-DD) */
function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}

/** ステータスページ表示時に、未実行の評価を自動実行する */
async function ensureStatusUpToDate(childId: number, tenantId: string) {
	const today = todayStr();

	// 日次衰退: 同じ日に既に実行済みかチェック
	if (!(await hasDecayRunToday(childId, today, tenantId))) {
		await runDailyDecay(tenantId, today);
	}

	// 先週分の週次評価が未実行なら実行
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

	// ステータスを最新化
	await ensureStatusUpToDate(child.id, tenantId);

	const [result, monthlyComparison] = await Promise.all([
		getChildStatus(child.id, tenantId),
		getMonthlyComparison(child.id, tenantId),
	]);
	if ('error' in result) {
		logger.warn('[upper/status] ステータス取得フォールバック', {
			context: { childId: child.id, error: result.error },
		});
		return { status: null, monthlyComparison: null };
	}

	return { status: result, monthlyComparison };
};
