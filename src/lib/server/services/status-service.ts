import type { CategoryId, ChildId } from '$lib/domain/ids';
// src/lib/server/services/status-service.ts
// ステータス管理サービス層

import { monthStartJST } from '$lib/domain/date-utils';
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
	childId: ChildId;
	/** @deprecated 全体レベルは廃止。カテゴリ別レベルを使用。後方互換のため残存 */
	level: number;
	/** @deprecated */
	levelTitle: string;
	/** @deprecated */
	expToNextLevel: number;
	maxValue: number;
	statuses: Record<string, StatusDetail>;
	characterType: string;
	highestCategoryLevel: number;
}

/** 子供のステータスを取得 */
export async function getChildStatus(
	childId: ChildId,
	tenantId: string,
): Promise<ChildStatus | { error: 'NOT_FOUND' }> {
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const [statusRows, customTitles] = await Promise.all([
		findStatuses(childId, tenantId),
		getCustomLevelTitles(tenantId),
	]);
	const statusMap: Record<string, StatusDetail> = {};

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
	current: Record<string, number>;
	previous: Record<string, number>;
	changes: Record<string, number>;
}

/** 先月末時点と現在のステータスを比較 */
export async function getMonthlyComparison(
	childId: ChildId,
	tenantId: string,
): Promise<MonthlyComparison | null> {
	const child = await findChildById(childId, tenantId);
	if (!child) return null;

	const statusRows = await findStatuses(childId, tenantId);

	// 先月末の日付を計算。月初境界は JST SSOT 経由で決める (#4015)。
	// 旧実装は `now.getFullYear()/getMonth()` のローカル月で、Lambda (UTC) では JST 月初
	// 00:00〜09:00 に前月 1 日が基準となり前月比が 1 ヶ月ずれていた。
	const lastMonthEnd = `${monthStartJST()}T00:00:00.000Z`;

	const current: Record<string, number> = {};
	const previous: Record<string, number> = {};
	const changes: Record<string, number> = {};

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
): Promise<Record<string, number>> {
	const result: Record<string, number> = {};
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
	childId: ChildId,
	tenantId: string,
): Promise<Record<string, CategoryXpInfo> | null> {
	const child = await findChildById(childId, tenantId);
	if (!child) return null;

	const [statusRows, customTitles] = await Promise.all([
		findStatuses(childId, tenantId),
		getCustomLevelTitles(tenantId),
	]);
	const result: Record<string, CategoryXpInfo> = {};

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
	categoryId: CategoryId;
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
	childId: ChildId,
	categoryId: CategoryId,
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
// レベル称号解決（#4688: settings 1 行に JSON で保持する）
//
// 旧実装は `level_titles` table 撤去後に **getCustomLevelTitles / saveLevelTitle を no-op stub の
// まま放置**していた。親の `/admin/status`「レベル称号カスタマイズ」は保存できたように見えて
// 何も残らず、子供画面にも当然出ない (#4688 F3 の根)。専用 table を復活させず、既存の
// settings (tenant scope の key-value) に JSON 1 行で持たせる (Pre-PMF、ADR-0010)。
// ============================================================

import { LEVEL_TABLE } from '$lib/domain/validation/status';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';

/** settings key。値は `{ "<level>": "<title>" }` の JSON。 */
const CUSTOM_LEVEL_TITLES_KEY = 'custom_level_titles';

/** settings の JSON を Map<level, title> に読み出す (壊れていれば空 Map)。 */
async function readCustomLevelTitles(tenantId: string): Promise<Map<number, string>> {
	const raw = await getSetting(CUSTOM_LEVEL_TITLES_KEY, tenantId);
	if (!raw) return new Map<number, string>();
	try {
		const parsed = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as Record<
			string,
			unknown
		>;
		const map = new Map<number, string>();
		for (const [level, title] of Object.entries(parsed)) {
			const n = Number(level);
			if (Number.isFinite(n) && typeof title === 'string' && title.trim() !== '') {
				map.set(n, title);
			}
		}
		return map;
	} catch {
		// 壊れた値は「カスタム無し」に倒す (画面を落とさない)
		return new Map<number, string>();
	}
}

/** Map<level, title> を settings に書き戻す (空なら空 JSON)。 */
async function writeCustomLevelTitles(
	tenantId: string,
	titles: Map<number, string>,
): Promise<void> {
	const obj: Record<string, string> = {};
	for (const [level, title] of titles) obj[String(level)] = title;
	await setSetting(CUSTOM_LEVEL_TITLES_KEY, JSON.stringify(obj), tenantId);
}

/** テナントのカスタムレベル称号を取得 (#4688: settings から実データを読む)。 */
export async function getCustomLevelTitles(tenantId: string): Promise<Map<number, string>> {
	return readCustomLevelTitles(tenantId);
}

/** レベルに対応する称号を解決 */
export function resolveLevelTitle(level: number, customTitles: Map<number, string>): string {
	const custom = customTitles.get(level);
	if (custom) return custom;
	const entry = LEVEL_TABLE.find((e) => e.level === level);
	return entry?.title ?? '';
}

/** レベル称号一覧を取得（デフォルト + 親が設定したカスタム、#4688）。 */
export async function getLevelTitleList(
	tenantId: string,
): Promise<{ level: number; defaultTitle: string; customTitle: string | null }[]> {
	const custom = await readCustomLevelTitles(tenantId);
	return LEVEL_TABLE.map((entry) => ({
		level: entry.level,
		defaultTitle: entry.title,
		customTitle: custom.get(entry.level) ?? null,
	}));
}

/** カスタムレベル称号を保存する (#4688: 空文字は「解除」として扱う)。 */
export async function saveLevelTitle(
	tenantId: string,
	level: number,
	customTitle: string,
): Promise<void> {
	const titles = await readCustomLevelTitles(tenantId);
	const trimmed = customTitle.trim();
	if (trimmed === '') {
		titles.delete(level);
	} else {
		titles.set(level, trimmed);
	}
	await writeCustomLevelTitles(tenantId, titles);
}

/** カスタムレベル称号を削除する (既定の称号に戻す)。 */
export async function resetLevelTitle(tenantId: string, level: number): Promise<void> {
	const titles = await readCustomLevelTitles(tenantId);
	if (!titles.delete(level)) return;
	await writeCustomLevelTitles(tenantId, titles);
}

/** 全カスタム称号をリセットする。 */
export async function resetAllLevelTitles(tenantId: string): Promise<void> {
	await writeCustomLevelTitles(tenantId, new Map<number, string>());
}
