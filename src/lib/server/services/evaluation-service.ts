// src/lib/server/services/evaluation-service.ts
// 週次評価・日次ステータス減少サービス

import { todayDateJST } from '$lib/domain/date-utils';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { type DecayIntensity, calcDecay } from '$lib/domain/validation/status';
import {
	countActivitiesByCategory,
	findAllChildren,
	findEvaluationsByChild,
	findLastActivityDateByCategory,
	insertEvaluation,
	isRestDay,
} from '$lib/server/db/evaluation-repo';
import { insertPointEntry } from '$lib/server/db/point-repo';
import { getSetting } from '$lib/server/db/settings-repo';
import { updateStatus } from '$lib/server/services/status-service';

/**
 * 週次評価ボーナスを活動回数から算出
 * （活動記録ごとに即時+0.3が付くため、週次はボーナスのみ）
 * 週間活動回数 >= 7 → +1.0
 * 週間活動回数 >= 5 → +0.5
 * 週間活動回数 >= 3 → +0.3
 * 週間活動回数 >= 1 → +0.0（即時更新分で十分）
 * 週間活動回数 == 0 → +0.0
 */
export function calcStatusIncrease(activityCount: number): number {
	if (activityCount >= 7) return 1.0;
	if (activityCount >= 5) return 0.5;
	if (activityCount >= 3) return 0.3;
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
	const d = new Date(date);
	// 前の週の月曜〜日曜を対象
	const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ...
	const daysToLastSunday = dayOfWeek === 0 ? 0 : dayOfWeek;
	const lastSunday = new Date(d);
	lastSunday.setDate(d.getDate() - daysToLastSunday);

	const lastMonday = new Date(lastSunday);
	lastMonday.setDate(lastSunday.getDate() - 6);

	return {
		weekStart: lastMonday.toISOString().slice(0, 10),
		weekEnd: lastSunday.toISOString().slice(0, 10),
	};
}

export interface EvaluationResult {
	childId: number;
	weekStart: string;
	weekEnd: string;
	categoryScores: Record<number, { count: number; points: number; statusIncrease: number }>;
	bonusPoints: number;
}

/** 子供1人分の週次評価を実行 */
export async function evaluateChild(
	childId: number,
	weekStart: string,
	weekEnd: string,
	tenantId: string,
): Promise<EvaluationResult> {
	const activityCounts = await countActivitiesByCategory(childId, weekStart, weekEnd, tenantId);

	const categoryScores: Record<number, { count: number; points: number; statusIncrease: number }> =
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
export async function runWeeklyEvaluation(
	tenantId: string,
	date?: Date,
): Promise<EvaluationResult[]> {
	const { weekStart, weekEnd } = getWeekRange(date);
	const allChildren = await findAllChildren(tenantId);

	const results: EvaluationResult[] = [];
	for (const child of allChildren) {
		results.push(await evaluateChild(child.id, weekStart, weekEnd, tenantId));
	}
	return results;
}

/** 子供の評価履歴を取得 */
export async function getChildEvaluations(childId: number, tenantId: string, limit = 10) {
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
		childId: number;
		decays: { categoryId: number; amount: number }[];
	}[]
> {
	const todayStr = today ?? todayDateJST();
	const intensity = await getDecayIntensity(tenantId);
	const allChildren = await findAllChildren(tenantId);
	const results: {
		childId: number;
		decays: { categoryId: number; amount: number }[];
	}[] = [];

	for (const child of allChildren) {
		// おやすみ日チェック
		const resting = await isRestDay(child.id, todayStr, tenantId);
		if (resting) {
			results.push({ childId: child.id, decays: [] });
			continue;
		}

		const lastActivityDates = await findLastActivityDateByCategory(child.id, tenantId);
		const decays: { categoryId: number; amount: number }[] = [];

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
