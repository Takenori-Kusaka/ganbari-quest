// src/lib/server/services/status-service.ts
// ステータス管理サービス層

import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import {
	calcCategoryExpToNextLevel,
	calcCategoryLevel,
	calcCharacterType,
	calcDeviationScore,
	calcStars,
	calcTrend,
	getMaxForAge,
} from '$lib/domain/validation/status';
import { getRepos } from '$lib/server/db/factory';
import {
	findBenchmark,
	findChildById,
	findRecentStatusHistory,
	findStatusValueAtDate,
	findStatuses,
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

	const maxValue = getMaxForAge(child.age);
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
		const value = row?.value ?? 0;

		// 市場比較（ベンチマーク）
		const benchmark = await findBenchmark(child.age, catDef.id, tenantId);
		const deviationScore = benchmark
			? calcDeviationScore(value, benchmark.mean, benchmark.stdDev)
			: 50; // ベンチマークがない場合は平均

		const stars = calcStars(value, maxValue);

		// 直近の変動履歴からトレンド判定
		const history = await findRecentStatusHistory(childId, catDef.id, tenantId, 2);
		const recentChange = history.length >= 2 ? (history[0]?.changeAmount ?? 0) : 0;
		const trend = calcTrend(recentChange);

		// カテゴリ別レベル
		const catLevel = calcCategoryLevel(value, maxValue);
		const catExp = calcCategoryExpToNextLevel(value, maxValue);

		statusMap[catDef.id] = {
			value: Math.round(value * 10) / 10,
			deviationScore,
			stars,
			trend,
			level: catLevel.level,
			levelTitle: resolveLevelTitle(catLevel.level, customTitles),
			expToNextLevel: Math.round(catExp * 10) / 10,
		};

		if (catLevel.level > highestCategoryLevel) {
			highestCategoryLevel = catLevel.level;
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
		maxValue,
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
		const currentValue = row?.value ?? 0;
		current[catDef.id] = Math.round(currentValue * 10) / 10;

		const prevValue = await findStatusValueAtDate(childId, catDef.id, lastMonthEnd, tenantId);
		previous[catDef.id] = prevValue !== null ? Math.round(prevValue * 10) / 10 : 0;
		const cur = current[catDef.id] ?? 0;
		const prev = previous[catDef.id] ?? 0;
		changes[catDef.id] = Math.round((cur - prev) * 10) / 10;
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
}

/** カテゴリ別XP情報を取得（ベンチマーク・偏差値を省略した軽量版） */
export async function getCategoryXpSummary(
	childId: number,
	tenantId: string,
): Promise<Record<number, CategoryXpInfo> | null> {
	const child = await findChildById(childId, tenantId);
	if (!child) return null;

	const maxValue = getMaxForAge(child.age);
	const [statusRows, customTitles] = await Promise.all([
		findStatuses(childId, tenantId),
		getCustomLevelTitles(tenantId),
	]);
	const result: Record<number, CategoryXpInfo> = {};

	for (const catDef of CATEGORY_DEFS) {
		const row = statusRows.find((s) => s.categoryId === catDef.id);
		const value = row?.value ?? 0;
		const catLevel = calcCategoryLevel(value, maxValue);
		const catExp = calcCategoryExpToNextLevel(value, maxValue);

		result[catDef.id] = {
			value: Math.round(value * 10) / 10,
			level: catLevel.level,
			levelTitle: resolveLevelTitle(catLevel.level, customTitles),
			expToNextLevel: Math.round(catExp * 10) / 10,
			maxValue,
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

/** ステータスを更新する（週次評価から呼ばれる） */
export async function updateStatus(
	childId: number,
	categoryId: number,
	changeAmount: number,
	changeType: string,
	tenantId: string,
): Promise<{ error: 'NOT_FOUND' } | StatusUpdateResult> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' as const };

	const maxValue = getMaxForAge(child.age);
	const allStatuses = await findStatuses(childId, tenantId);

	// 更新前の対象カテゴリレベルを計算
	const currentStatus = allStatuses.find((s) => s.categoryId === categoryId);
	const currentValue = currentStatus?.value ?? 0;
	const beforeLevel = calcCategoryLevel(currentValue, maxValue);

	// ステータス値を更新
	const newValue = Math.max(0, Math.min(maxValue, currentValue + changeAmount));

	await upsertStatus(childId, categoryId, newValue, tenantId);

	await insertStatusHistory(
		{
			childId,
			categoryId,
			value: newValue,
			changeAmount,
			changeType,
		},
		tenantId,
	);

	// 更新後の対象カテゴリレベルを計算
	const afterLevel = calcCategoryLevel(newValue, maxValue);

	const catDef = CATEGORY_DEFS.find((c) => c.id === categoryId);
	let levelUp: LevelUpInfo | null = null;

	if (afterLevel.level > beforeLevel.level) {
		// カスタム称号を解決
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
		valueBefore: currentValue,
		valueAfter: newValue,
		maxValue,
	};
}

// ============================================================
// カスタムレベル称号
// ============================================================

import { LEVEL_TABLE } from '$lib/domain/validation/status';

/** テナントのカスタムレベル称号を取得（Map形式） */
export async function getCustomLevelTitles(tenantId: string): Promise<Map<number, string>> {
	const rows = await getRepos().levelTitle.findByTenant(tenantId);
	const map = new Map<number, string>();
	for (const row of rows) {
		map.set(row.level, row.customTitle);
	}
	return map;
}

/** カスタム称号を考慮してレベルに対応する称号を解決 */
export function resolveLevelTitle(level: number, customTitles: Map<number, string>): string {
	const custom = customTitles.get(level);
	if (custom) return custom;
	const entry = LEVEL_TABLE.find((e) => e.level === level);
	return entry?.title ?? '';
}

/** レベル称号一覧を取得（カスタム + デフォルトの統合ビュー） */
export async function getLevelTitleList(
	tenantId: string,
): Promise<{ level: number; defaultTitle: string; customTitle: string | null }[]> {
	const customMap = await getCustomLevelTitles(tenantId);
	return LEVEL_TABLE.map((entry) => ({
		level: entry.level,
		defaultTitle: entry.title,
		customTitle: customMap.get(entry.level) ?? null,
	}));
}

/** カスタムレベル称号を保存 */
export async function saveLevelTitle(
	tenantId: string,
	level: number,
	customTitle: string,
): Promise<void> {
	await getRepos().levelTitle.upsert(tenantId, level, customTitle.trim());
}

/** カスタムレベル称号を削除（デフォルトに戻す） */
export async function resetLevelTitle(tenantId: string, level: number): Promise<void> {
	await getRepos().levelTitle.deleteByTenantAndLevel(tenantId, level);
}

/** 全カスタム称号をリセット */
export async function resetAllLevelTitles(tenantId: string): Promise<void> {
	await getRepos().levelTitle.deleteAllByTenant(tenantId);
}
