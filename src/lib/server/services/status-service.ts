// src/lib/server/services/status-service.ts
// ステータス管理サービス層

import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import {
	calcCharacterType,
	calcDeviationScore,
	calcLevelFromXp,
	calcStars,
	calcTrend,
	calcXpToNextLevel,
	clampDecayFloor,
} from '$lib/domain/validation/status';
import {
	findBenchmark,
	findChildById,
	findRecentStatusHistory,
	findStatuses,
	findStatusValueAtDate,
	insertStatusHistory,
	upsertStatus,
} from '$lib/server/db/status-repo';

export interface StatusDetail {
	value: number;
	deviationScore: number;
	stars: number;
	trend: 'up' | 'down' | 'stable';
	level: number;
	levelTitle: string;
	expToNextLevel: number;
	/** 現レベル内の進捗% (0-100) */
	progressPct: number;
}

export interface ChildStatus {
	childId: number;
	/** @deprecated 全体レベルは廃止。カテゴリ別レベルを使用。後方互換のため残存 */
	level: number;
	/** @deprecated */
	levelTitle: string;
	/** @deprecated */
	expToNextLevel: number;
	maxValue: number;
	statuses: Record<number, StatusDetail>;
	characterType: string;
	highestCategoryLevel: number;
}

/** 子供のステータスを取得 */
export async function getChildStatus(
	childId: number,
	tenantId: string,
): Promise<ChildStatus | { error: 'NOT_FOUND' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const [statusRows, customTitles] = await Promise.all([
		findStatuses(childId, tenantId),
		getCustomLevelTitles(tenantId),
	]);
	const statusMap: Record<number, StatusDetail> = {};

	let totalDeviation = 0;
	let categoryCount = 0;
	let highestCategoryLevel = 0;

	for (const catDef of CATEGORY_DEFS) {
		const row = statusRows.find((s) => s.categoryId === catDef.id);
		const totalXp = row?.totalXp ?? 0;

		// 市場比較（ベンチマーク）
		const benchmark = await findBenchmark(child.age, catDef.id, tenantId);
		const deviationScore = benchmark
			? calcDeviationScore(totalXp, benchmark.mean, benchmark.stdDev)
			: 50;

		const stars = benchmark ? calcStars(totalXp, benchmark.mean) : 3;

		// 直近の変動履歴からトレンド判定
		const history = await findRecentStatusHistory(childId, catDef.id, tenantId, 2);
		const recentChange = history.length >= 2 ? (history[0]?.changeAmount ?? 0) : 0;
		const trend = calcTrend(recentChange);

		// カテゴリ別レベル（新XPベース）
		const { level, title } = calcLevelFromXp(totalXp);
		const xpInfo = calcXpToNextLevel(totalXp);

		statusMap[catDef.id] = {
			value: totalXp,
			deviationScore,
			stars,
			trend,
			level,
			levelTitle: resolveLevelTitle(level, customTitles) || title,
			expToNextLevel: xpInfo.xpNeeded,
			progressPct: xpInfo.progressPct,
		};

		if (level > highestCategoryLevel) {
			highestCategoryLevel = level;
		}

		totalDeviation += deviationScore;
		categoryCount++;
	}

	const avgDeviation = categoryCount > 0 ? totalDeviation / categoryCount : 50;
	const characterType = calcCharacterType(avgDeviation);

	return {
		childId,
		level: highestCategoryLevel,
		levelTitle: resolveLevelTitle(highestCategoryLevel, customTitles),
		expToNextLevel: 0,
		maxValue: 100000,
		statuses: statusMap,
		characterType,
		highestCategoryLevel,
	};
}

/** 月次比較データ */
export interface MonthlyComparison {
	current: Record<number, number>;
	previous: Record<number, number>;
	changes: Record<number, number>;
}

/** 先月末時点と現在のステータスを比較 */
export async function getMonthlyComparison(
	childId: number,
	tenantId: string,
): Promise<MonthlyComparison | null> {
	const child = await findChildById(childId, tenantId);
	if (!child) return null;

	const statusRows = await findStatuses(childId, tenantId);

	// 先月末の日付を計算
	const now = new Date();
	const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const lastMonthEnd = firstOfMonth.toISOString();

	const current: Record<number, number> = {};
	const previous: Record<number, number> = {};
	const changes: Record<number, number> = {};

	for (const catDef of CATEGORY_DEFS) {
		const row = statusRows.find((s) => s.categoryId === catDef.id);
		const currentXp = row?.totalXp ?? 0;
		current[catDef.id] = currentXp;

		const prevValue = await findStatusValueAtDate(childId, catDef.id, lastMonthEnd, tenantId);
		previous[catDef.id] = prevValue ?? 0;
		const cur = current[catDef.id] ?? 0;
		const prev = previous[catDef.id] ?? 0;
		changes[catDef.id] = cur - prev;
	}

	return { current, previous, changes };
}

/** ベンチマーク平均値を取得（レーダーチャート比較用） */
export async function getBenchmarkValues(
	age: number,
	tenantId: string,
): Promise<Record<number, number>> {
	const result: Record<number, number> = {};
	for (const catDef of CATEGORY_DEFS) {
		const benchmark = await findBenchmark(age, catDef.id, tenantId);
		result[catDef.id] = benchmark?.mean ?? 0;
	}
	return result;
}

/** カテゴリXPサマリ（ホームページ用の軽量版） */
export interface CategoryXpInfo {
	value: number;
	level: number;
	levelTitle: string;
	expToNextLevel: number;
	maxValue: number;
	/** 現レベル内の進捗% (0-100) */
	progressPct: number;
}

/** カテゴリ別XP情報を取得（ベンチマーク・偏差値を省略した軽量版） */
export async function getCategoryXpSummary(
	childId: number,
	tenantId: string,
): Promise<Record<number, CategoryXpInfo> | null> {
	const child = await findChildById(childId, tenantId);
	if (!child) return null;

	const [statusRows, customTitles] = await Promise.all([
		findStatuses(childId, tenantId),
		getCustomLevelTitles(tenantId),
	]);
	const result: Record<number, CategoryXpInfo> = {};

	for (const catDef of CATEGORY_DEFS) {
		const row = statusRows.find((s) => s.categoryId === catDef.id);
		const totalXp = row?.totalXp ?? 0;
		const { level, title } = calcLevelFromXp(totalXp);
		const xpInfo = calcXpToNextLevel(totalXp);

		result[catDef.id] = {
			value: totalXp,
			level,
			levelTitle: resolveLevelTitle(level, customTitles) || title,
			expToNextLevel: xpInfo.xpNeeded,
			maxValue: 100000,
			progressPct: xpInfo.progressPct,
		};
	}

	return result;
}

export interface LevelUpInfo {
	oldLevel: number;
	oldTitle: string;
	newLevel: number;
	newTitle: string;
	categoryId: number;
	categoryName: string;
	spGranted: number;
}

/** ステータス更新結果 */
export interface StatusUpdateResult {
	levelUp: LevelUpInfo | null;
	valueBefore: number;
	valueAfter: number;
	maxValue: number;
}

/** ステータスを更新する（活動記録・週次評価・日次減衰から呼ばれる） */
export async function updateStatus(
	childId: number,
	categoryId: number,
	changeAmount: number,
	changeType: string,
	tenantId: string,
): Promise<{ error: 'NOT_FOUND' } | StatusUpdateResult> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' as const };

	const allStatuses = await findStatuses(childId, tenantId);
	const currentStatus = allStatuses.find((s) => s.categoryId === categoryId);
	const currentXp = currentStatus?.totalXp ?? 0;
	const currentPeakXp = currentStatus?.peakXp ?? 0;
	const beforeLevel = calcLevelFromXp(currentXp);

	// XP更新（減衰時はpeak floor を適用）
	let newXp: number;
	if (changeAmount < 0) {
		newXp = clampDecayFloor(currentXp, Math.abs(changeAmount), currentPeakXp);
	} else {
		newXp = currentXp + changeAmount;
	}
	newXp = Math.max(0, newXp);

	// peakXp更新（増加時のみ）
	const newPeakXp = Math.max(currentPeakXp, newXp);

	// レベル計算
	const afterLevel = calcLevelFromXp(newXp);

	await upsertStatus(childId, categoryId, newXp, afterLevel.level, newPeakXp, tenantId);

	await insertStatusHistory(
		{
			childId,
			categoryId,
			value: newXp,
			changeAmount,
			changeType,
		},
		tenantId,
	);

	const catDef = CATEGORY_DEFS.find((c) => c.id === categoryId);
	let levelUp: LevelUpInfo | null = null;

	if (afterLevel.level > beforeLevel.level) {
		const customTitles = await getCustomLevelTitles(tenantId);

		levelUp = {
			oldLevel: beforeLevel.level,
			oldTitle: resolveLevelTitle(beforeLevel.level, customTitles),
			newLevel: afterLevel.level,
			newTitle: resolveLevelTitle(afterLevel.level, customTitles),
			categoryId,
			categoryName: catDef?.name ?? '',
			spGranted: 0,
		};
	}

	return {
		levelUp,
		valueBefore: currentXp,
		valueAfter: newXp,
		maxValue: 100000,
	};
}

// ============================================================
// レベル称号解決（カスタムレベル称号テーブル廃止後はデフォルトのみ）
// ============================================================

import { LEVEL_TABLE } from '$lib/domain/validation/status';

/** テナントのカスタムレベル称号を取得（廃止済み — 常に空Mapを返す） */
export async function getCustomLevelTitles(_tenantId: string): Promise<Map<number, string>> {
	return new Map<number, string>();
}

/** レベルに対応する称号を解決 */
export function resolveLevelTitle(level: number, customTitles: Map<number, string>): string {
	const custom = customTitles.get(level);
	if (custom) return custom;
	const entry = LEVEL_TABLE.find((e) => e.level === level);
	return entry?.title ?? '';
}

/** レベル称号一覧を取得（デフォルトのみ） */
export async function getLevelTitleList(
	_tenantId: string,
): Promise<{ level: number; defaultTitle: string; customTitle: string | null }[]> {
	return LEVEL_TABLE.map((entry) => ({
		level: entry.level,
		defaultTitle: entry.title,
		customTitle: null,
	}));
}

/** カスタムレベル称号を保存（廃止済み — no-op） */
export async function saveLevelTitle(
	_tenantId: string,
	_level: number,
	_customTitle: string,
): Promise<void> {
	// level_titles table removed — no-op
}

/** カスタムレベル称号を削除（廃止済み — no-op） */
export async function resetLevelTitle(_tenantId: string, _level: number): Promise<void> {
	// level_titles table removed — no-op
}

/** 全カスタム称号をリセット（廃止済み — no-op） */
export async function resetAllLevelTitles(_tenantId: string): Promise<void> {
	// level_titles table removed — no-op
}
