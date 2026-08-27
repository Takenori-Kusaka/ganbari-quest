import type { CategoryId, ChildId } from '$lib/domain/ids';
// src/lib/server/services/evaluation-service.ts
// 週次評価・日次ステータス減少サービス

import {
	addDaysJST,
	jstDayOfWeek,
	todayDateJST,
	toJSTDateString,
	weekStartJST,
} from '$lib/domain/date-utils';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { calcDecay, type DecayIntensity } from '$lib/domain/validation/status';
import {
	countActivitiesByCategory,
	findAllChildren,
	findEvaluationsByChild,
	findLastActivityDateByCategory,
	insertEvaluation,
} from '$lib/server/db/evaluation-repo';
import { insertPointEntry } from '$lib/server/db/point-repo';
import { getSetting } from '$lib/server/db/settings-repo';
import { updateStatus } from '$lib/server/services/status-service';

/**
 * 週次評価ボーナスXPを活動回数から算出（整数XPスケール）
 * （活動記録ごとに即時 totalPoints 分のXPが付くため、週次はボーナスのみ）
 * 週間活動回数 >= 7 → +27 XP
 * 週間活動回数 >= 5 → +14 XP
 * 週間活動回数 >= 3 → +8 XP
 * 週間活動回数 >= 1 → +0（即時更新分で十分）
 * 週間活動回数 == 0 → +0
 */
export function calcStatusIncrease(activityCount: number): number {
	if (activityCount >= 7) return 27;
	if (activityCount >= 5) return 14;
	if (activityCount >= 3) return 8;
	return 0;
}

/** ボーナスポイント算出（全カテゴリ活動した場合に追加） */
export function calcEvaluationBonus(
	categoryScores: Record<string, { count: number; points: number }>,
): number {
	const activeCats = Object.values(categoryScores).filter((s) => s.count > 0).length;

	// 全カテゴリ活動ボーナス
	if (activeCats >= 5) return 20;
	if (activeCats >= 4) return 10;
	if (activeCats >= 3) return 5;
	return 0;
}

/** 週の開始日（月曜）と終了日（日曜）を計算 */
export function getWeekRange(date: Date = new Date()): {
	weekStart: string;
	weekEnd: string;
} {
	// 前の週の月曜〜日曜を対象。JST SSOT 経由で決める (#4015)。
	// 旧実装は `d.getDay()` / `setDate(d.getDate() - n)` のローカル TZ 算術に `toISOString()` の
	// UTC 日付化を重ねており、Lambda (UTC) では JST 00:00〜09:00 に週範囲が 1 日ずれていた。
	const todayJST = toJSTDateString(date);
	// 「直近の日曜」= 当日が日曜ならその日、そうでなければ今週月曜の前日
	const lastSunday = jstDayOfWeek(date) === 0 ? todayJST : addDaysJST(weekStartJST(date), -1);

	return {
		weekStart: addDaysJST(lastSunday, -6),
		weekEnd: lastSunday,
	};
}

export interface EvaluationResult {
	childId: ChildId;
	weekStart: string;
	weekEnd: string;
	categoryScores: Record<string, { count: number; points: number; statusIncrease: number }>;
	bonusPoints: number;
}

/** 子供1人分の週次評価を実行 */
export async function evaluateChild(
	childId: ChildId,
	weekStart: string,
	weekEnd: string,
	tenantId: string,
): Promise<EvaluationResult> {
	const activityCounts = await countActivitiesByCategory(childId, weekStart, weekEnd, tenantId);

	const categoryScores: Record<string, { count: number; points: number; statusIncrease: number }> =
		{};

	for (const catDef of CATEGORY_DEFS) {
		const row = activityCounts.find((a) => a.categoryId === catDef.id);
		const count = row?.count ?? 0;
		const points = row?.totalPoints ?? 0;
		const statusIncrease = calcStatusIncrease(count);

		categoryScores[catDef.id] = { count, points, statusIncrease };

		// ステータス更新
		if (statusIncrease > 0) {
			await updateStatus(childId, catDef.id, statusIncrease, 'weekly_evaluation', tenantId);
		}
	}

	// ボーナスポイント算出
	const bonusPoints = calcEvaluationBonus(categoryScores);

	// 評価結果保存
	await insertEvaluation(
		{
			childId,
			weekStart,
			weekEnd,
			scoresJson: JSON.stringify(categoryScores),
			bonusPoints,
		},
		tenantId,
	);

	// ボーナスポイント付与
	if (bonusPoints > 0) {
		await insertPointEntry(
			{
				childId,
				amount: bonusPoints,
				type: 'weekly_bonus',
				description: `しゅうかんひょうかボーナス +${bonusPoints}P`,
			},
			tenantId,
		);
	}

	return { childId, weekStart, weekEnd, categoryScores, bonusPoints };
}

/** 全子供の週次評価を一括実行 */
async function _runWeeklyEvaluation(tenantId: string, date?: Date): Promise<EvaluationResult[]> {
	const { weekStart, weekEnd } = getWeekRange(date);
	const allChildren = await findAllChildren(tenantId);

	const results: EvaluationResult[] = [];
	for (const child of allChildren) {
		results.push(await evaluateChild(child.id, weekStart, weekEnd, tenantId));
	}
	return results;
}

/** 子供の評価履歴を取得 */
export async function getChildEvaluations(childId: ChildId, tenantId: string, limit = 10) {
	const results = await findEvaluationsByChild(childId, limit, tenantId);
	return results.map((e) => ({
		...e,
		scores: JSON.parse(e.scoresJson),
	}));
}

/** 減少強度設定を取得 */
async function getDecayIntensity(tenantId: string): Promise<DecayIntensity> {
	const value = await getSetting('decay_intensity', tenantId);
	if (value === 'none' || value === 'gentle' || value === 'normal' || value === 'strict') {
		return value;
	}
	return 'normal';
}

/** 日次ステータス減少処理（猶予2日、おやすみ日対応） */
export async function runDailyDecay(
	tenantId: string,
	today?: string,
): Promise<
	{
		childId: ChildId;
		decays: { categoryId: CategoryId; amount: number }[];
	}[]
> {
	const todayStr = today ?? todayDateJST();
	const intensity = await getDecayIntensity(tenantId);
	const allChildren = await findAllChildren(tenantId);
	const results: {
		childId: ChildId;
		decays: { categoryId: CategoryId; amount: number }[];
	}[] = [];

	for (const child of allChildren) {
		// #4691: おやすみ日 (rest_days) による減衰スキップは撤去 (登録導線が無く常に空だった)。
		const lastActivityDates = await findLastActivityDateByCategory(child.id, tenantId);
		const decays: { categoryId: CategoryId; amount: number }[] = [];

		for (const catDef of CATEGORY_DEFS) {
			const row = lastActivityDates.find((r) => r.categoryId === catDef.id);
			if (!row?.lastDate) continue;

			const lastDate = new Date(row.lastDate);
			const todayDate = new Date(todayStr);
			const diffMs = todayDate.getTime() - lastDate.getTime();
			const daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24));

			if (daysSince > 0) {
				const decayAmount = calcDecay(daysSince, child.age, intensity);
				if (decayAmount > 0) {
					await updateStatus(child.id, catDef.id, -decayAmount, 'daily_decay', tenantId);
					decays.push({ categoryId: catDef.id, amount: decayAmount });
				}
			}
		}

		results.push({ childId: child.id, decays });
	}

	return results;
}
