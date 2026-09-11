import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/report-service.ts
// 月次レポート・成長分析のサービス層

import { isFutureMonth, resolveChildLevel, resolveChildTotalXp } from '$lib/domain/child-metrics';
import { addDaysJST, monthEndOfKey, prevDateJST, todayDateJST } from '$lib/domain/date-utils';
import { getRepos } from '$lib/server/db/factory';
import type { ReportDailySummary } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';

// ============================================================
// 日次バッチ集計
// ============================================================

/**
 * 指定日のレポートサマリーを集計・保存する
 * 全子供分を一括処理
 */
export async function aggregateDailyReport(tenantId: string, date: string): Promise<number> {
	const repos = getRepos();
	const children = await repos.child.findAllChildren(tenantId);

	let processed = 0;
	for (const child of children) {
		try {
			await aggregateChildDaily(tenantId, child.id, date);
			processed++;
		} catch (e) {
			logger.error('Failed to aggregate daily report for child', {
				context: { tenantId, childId: child.id, date, error: String(e) },
			});
		}
	}
	return processed;
}

/**
 * 1子供1日分の集計を行いupsert
 */
async function aggregateChildDaily(
	tenantId: string,
	childId: ChildId,
	date: string,
): Promise<void> {
	const repos = getRepos();

	// 活動ログ集計（categoryId 付きで取得）
	const logs = await repos.activity.findTodayLogsWithCategory(childId, date, tenantId);
	const activityCount = logs.length;

	// カテゴリ別内訳
	const categoryMap: Record<string, number> = {};
	for (const log of logs) {
		const catId = String(log.categoryId ?? 'unknown');
		categoryMap[catId] = (categoryMap[catId] ?? 0) + 1;
	}

	// チェックリスト達成率（テンプレートごと）
	const checklistCompletion: Record<string, number> = {};
	// チェックリストのリスト集計は簡易実装のため空 JSON で保存
	// 今後テンプレート一覧からループして findTodayLog を呼ぶ形で拡張可能

	// レベル・ポイント取得
	const statuses = await repos.status.findStatuses(childId, tenantId);
	const totalPoints = statuses.reduce((sum, s) => sum + (s.totalXp ?? 0), 0);
	const maxLevel = statuses.reduce((max, s) => Math.max(max, s.level ?? 1), 1);

	// ストリーク計算（直近の連続日数）
	const streakDays = await calculateStreak(childId, date, tenantId);

	// 実績システム廃止（#322）— 常に0
	const newAchievements = 0;

	await repos.reportDailySummary.upsert({
		tenantId,
		childId,
		date,
		activityCount,
		categoryBreakdown: JSON.stringify(categoryMap),
		checklistCompletion: JSON.stringify(checklistCompletion),
		level: maxLevel,
		totalPoints,
		streakDays,
		newAchievements,
	});
}

async function calculateStreak(childId: ChildId, date: string, tenantId: string): Promise<number> {
	const repos = getRepos();
	let streak = 0;
	// 日付は JST 暦日の文字列で回す (Date + ローカル setDate は runtime TZ で結果が変わる、#4127)
	let checkDate = date;

	for (let i = 0; i < 365; i++) {
		const logs = await repos.activity.findTodayLogsWithCategory(childId, checkDate, tenantId);
		if (logs.length === 0) break;
		streak++;
		checkDate = prevDateJST(checkDate);
	}
	return streak;
}

// 実績システム廃止（#322）— countNewAchievements 削除

// ============================================================
// クエリ — 月次レポート用
// ============================================================

export interface MonthlySummary {
	childId: ChildId;
	childName: string;
	month: string;
	totalActivities: number;
	categoryBreakdown: Record<string, number>;
	avgDailyActivities: number;
	currentLevel: number;
	totalPoints: number;
	maxStreakDays: number;
	totalNewAchievements: number;
	checklistAvgCompletion: number;
	daysWithActivity: number;
	totalDays: number;
}

/**
 * 指定月の月次サマリーを取得（1子供分）
 */
export async function getMonthlyReport(
	tenantId: string,
	childId: ChildId,
	yearMonth: string,
): Promise<MonthlySummary | null> {
	const repos = getRepos();
	const startDate = `${yearMonth}-01`;
	const endDate = getMonthEndDate(yearMonth);

	const summaries = await repos.reportDailySummary.findByChildAndDateRange(
		childId,
		startDate,
		endDate,
		tenantId,
	);

	if (summaries.length === 0) return null;

	const children = await repos.child.findAllChildren(tenantId);
	const child = children.find((c) => c.id === childId);
	if (!child) return null;

	return buildMonthlySummary(child.nickname, childId, yearMonth, summaries);
}

/**
 * 全子供分の月次サマリーを取得
 */
export async function getAllChildrenMonthlyReport(
	tenantId: string,
	yearMonth: string,
): Promise<MonthlySummary[]> {
	const repos = getRepos();
	const startDate = `${yearMonth}-01`;
	const endDate = getMonthEndDate(yearMonth);

	const allSummaries = await repos.reportDailySummary.findByTenantAndDateRange(
		tenantId,
		startDate,
		endDate,
	);

	if (allSummaries.length === 0) return [];

	const children = await repos.child.findAllChildren(tenantId);
	const childMap = new Map(children.map((c) => [c.id, c.nickname]));

	// Group by childId
	const grouped = new Map<ChildId, ReportDailySummary[]>();
	for (const s of allSummaries) {
		const arr = grouped.get(s.childId) ?? [];
		arr.push(s);
		grouped.set(s.childId, arr);
	}

	const results: MonthlySummary[] = [];
	for (const [childId, summaries] of grouped) {
		const name = childMap.get(childId) ?? `子供${childId}`;
		results.push(buildMonthlySummary(name, childId, yearMonth, summaries));
	}
	return results;
}

function buildMonthlySummary(
	childName: string,
	childId: ChildId,
	yearMonth: string,
	summaries: ReportDailySummary[],
): MonthlySummary {
	const totalActivities = summaries.reduce((sum, s) => sum + s.activityCount, 0);
	const daysWithActivity = summaries.filter((s) => s.activityCount > 0).length;
	const totalDays = summaries.length;

	// Merge category breakdowns
	const mergedCategories: Record<string, number> = {};
	for (const s of summaries) {
		const cat = JSON.parse(s.categoryBreakdown) as Record<string, number>;
		for (const [k, v] of Object.entries(cat)) {
			mergedCategories[k] = (mergedCategories[k] ?? 0) + v;
		}
	}

	// Checklist average completion rate
	let checklistTotal = 0;
	let checklistCount = 0;
	for (const s of summaries) {
		const cl = JSON.parse(s.checklistCompletion) as Record<string, number>;
		for (const v of Object.values(cl)) {
			checklistTotal += v;
			checklistCount++;
		}
	}

	const last = summaries[summaries.length - 1];

	return {
		childId,
		childName,
		month: yearMonth,
		totalActivities,
		categoryBreakdown: mergedCategories,
		avgDailyActivities: totalDays > 0 ? Math.round((totalActivities / totalDays) * 10) / 10 : 0,
		currentLevel: last?.level ?? 1,
		totalPoints: last?.totalPoints ?? 0,
		maxStreakDays: Math.max(...summaries.map((s) => s.streakDays), 0),
		totalNewAchievements: summaries.reduce((sum, s) => sum + s.newAchievements, 0),
		checklistAvgCompletion:
			checklistCount > 0 ? Math.round((checklistTotal / checklistCount) * 100) : 0,
		daysWithActivity,
		totalDays,
	};
}

// ============================================================
// リアルタイム簡易サマリー（AdminHome 表示用、全プラン対象）
// ============================================================

export interface SimpleMonthSummary {
	totalActivities: number;
	currentLevel: number;
	newAchievements: number;
}

/**
 * 今月の簡易サマリーを取得（リアルタイム計算）
 * AdminHome のカードに表示する用途
 */
export async function getSimpleMonthSummary(
	tenantId: string,
	childId: ChildId,
	yearMonth: string,
): Promise<SimpleMonthSummary> {
	const repos = getRepos();
	const startDate = `${yearMonth}-01`;
	const endDate = getMonthEndDate(yearMonth);

	// まず集計テーブルを試す
	const summaries = await repos.reportDailySummary.findByChildAndDateRange(
		childId,
		startDate,
		endDate,
		tenantId,
	);

	// #4719: レベルは常に statuses から realtime 導出する (全 backend 共通)。
	// 集計 summary の `level` は当日 snapshot の意味しか持たず、pg-core (DSQL / PGlite) の
	// compute-on-read summary は snapshot を持てない (既定 1) ため、summary 経路に乗ると
	// ホーム / 月次レポートのレベルが常に 1 になっていた (#4680 class)。
	const currentLevel = await computeCurrentLevel(repos, childId, tenantId);

	if (summaries.length > 0) {
		const totalActivities = summaries.reduce((sum, s) => sum + s.activityCount, 0);
		const totalNewAchievements = summaries.reduce((sum, s) => sum + s.newAchievements, 0);
		return {
			totalActivities,
			currentLevel,
			newAchievements: totalNewAchievements,
		};
	}

	// 集計テーブルがなければリアルタイム計算
	let totalActivities = 0;
	const today = todayDateJST();
	const limit = endDate < today ? endDate : today;

	for (let dateStr = startDate; dateStr <= limit; dateStr = addDaysJST(dateStr, 1)) {
		const logs = await repos.activity.findTodayLogsWithCategory(childId, dateStr, tenantId);
		totalActivities += logs.length;
	}

	const newAchievements = await countMonthAchievements(childId, startDate, endDate, tenantId);

	return {
		totalActivities,
		currentLevel,
		newAchievements,
	};
}

/**
 * #4719: 現在レベル (statuses の最大 level) の realtime 導出。summary 集計表の level snapshot は
 * backend によって持てない (pg-core は compute-on-read で既定 1) ため、表示用レベルは常にここから取る。
 */
async function computeCurrentLevel(
	repos: ReturnType<typeof getRepos>,
	childId: ChildId,
	tenantId: string,
): Promise<number> {
	const statuses = await repos.status.findStatuses(childId, tenantId);
	// #4697: レベル定義は domain SSOT (`resolveChildLevel`) 1 箇所。
	return resolveChildLevel(statuses);
}

/**
 * 全子供の簡易サマリーを一括取得
 */
export async function getAllChildrenSimpleSummary(
	tenantId: string,
	yearMonth: string,
): Promise<Map<ChildId, SimpleMonthSummary>> {
	const repos = getRepos();
	const children = await repos.child.findAllChildren(tenantId);
	const result = new Map<ChildId, SimpleMonthSummary>();

	for (const child of children) {
		try {
			const summary = await getSimpleMonthSummary(tenantId, child.id, yearMonth);
			result.set(child.id, summary);
		} catch {
			result.set(child.id, { totalActivities: 0, currentLevel: 1, newAchievements: 0 });
		}
	}
	return result;
}

// 実績システム廃止（#322）— 常に0
async function countMonthAchievements(
	_childId: ChildId,
	_startDate: string,
	_endDate: string,
	_tenantId: string,
): Promise<number> {
	return 0;
}

// ============================================================
// 詳細月次レポート（スタンダード以上）
// ============================================================

export interface DetailedMonthlySummary {
	childId: ChildId;
	childName: string;
	month: string;
	totalActivities: number;
	categoryBreakdown: Record<string, number>;
	avgDailyActivities: number;
	currentLevel: number;
	/**
	 * #4697: **その月に台帳 (`point_ledger`) で獲得したポイント**の合計。
	 *
	 * 子供画面の所持ポイントと同じ単位で、月ごとに独立した量。旧実装はここに
	 * `statuses.total_xp` の累計を入れていたため、どの月を見ても同じ数が出て先月比が
	 * 常に ±0 になり、成長記録ブックは「累計 × 12 ヶ月」を年間合計として出していた。
	 */
	totalPoints: number;
	/**
	 * #4697: 「つよさ (XP)」= カテゴリ別 totalXp の累計 (登録以降の総量、月に依存しない)。
	 * ポイントとは別の量なので別フィールドで持ち、画面でも別の名前で出す。
	 */
	totalXp: number;
	maxStreakDays: number;
	totalNewAchievements: number;
	daysWithActivity: number;
	totalDays: number;
	/**
	 * #4697: `yearMonth` が今日 (JST) より後の月か。成長記録ブックは 4 月〜翌 3 月を必ず
	 * 12 行並べるため未来月の枠が生まれる。画面はここを見て数値でなく「—」を出す。
	 */
	isFuture: boolean;
}

/**
 * 詳細月次レポートをリアルタイム計算（集計テーブル未使用）
 */
export async function computeDetailedMonthlyReport(
	tenantId: string,
	childId: ChildId,
	childName: string,
	yearMonth: string,
): Promise<DetailedMonthlySummary> {
	const repos = getRepos();
	const startDate = `${yearMonth}-01`;
	const endDate = getMonthEndDate(yearMonth);

	// 集計テーブルがあればそれを使う
	const summaries = await repos.reportDailySummary.findByChildAndDateRange(
		childId,
		startDate,
		endDate,
		tenantId,
	);

	// #4719: レベル / XP は summary snapshot でなく statuses から realtime 導出 (全 backend 共通)。
	// pg-core の compute-on-read summary は level snapshot を持てない (既定 1)。
	// #4697: 定義は domain の 1 関数群に寄せる (閲覧リンク / 証明書 / 成長記録ブックと同じ数になる)。
	const statuses = await repos.status.findStatuses(childId, tenantId);
	const realtimeLevel = resolveChildLevel(statuses);
	const realtimeTotalXp = resolveChildTotalXp(statuses);

	// #4697: 「ポイント」は台帳のその月の獲得合計。旧実装の XP 累計は月ごとに変わらないため
	// 先月比が常に ±0 になり、成長記録ブックでは 12 ヶ月ぶん足されて年間合計が累計 × 12 になっていた。
	const today = todayDateJST();
	const isFuture = isFutureMonth(yearMonth, today);
	const earnedPoints = isFuture
		? 0
		: await repos.point.sumEarnedPointsBetween(childId, startDate, endDate, tenantId);

	if (summaries.length > 0) {
		const built = buildMonthlySummary(childName, childId, yearMonth, summaries);
		return {
			childId: built.childId,
			childName: built.childName,
			month: built.month,
			totalActivities: built.totalActivities,
			categoryBreakdown: built.categoryBreakdown,
			avgDailyActivities: built.avgDailyActivities,
			currentLevel: realtimeLevel,
			totalPoints: earnedPoints,
			totalXp: realtimeTotalXp,
			maxStreakDays: built.maxStreakDays,
			totalNewAchievements: built.totalNewAchievements,
			daysWithActivity: built.daysWithActivity,
			totalDays: built.totalDays,
			isFuture,
		};
	}

	// リアルタイム計算
	let totalActivities = 0;
	let daysWithActivity = 0;
	let totalDays = 0;
	const categoryMap: Record<string, number> = {};

	const limit = endDate < today ? endDate : today;

	for (let dateStr = startDate; dateStr <= limit; dateStr = addDaysJST(dateStr, 1)) {
		const logs = await repos.activity.findTodayLogsWithCategory(childId, dateStr, tenantId);
		totalDays++;
		if (logs.length > 0) {
			daysWithActivity++;
			totalActivities += logs.length;
			for (const log of logs) {
				const catId = String(log.categoryId ?? 'unknown');
				categoryMap[catId] = (categoryMap[catId] ?? 0) + 1;
			}
		}
	}

	const streakDays = await calculateStreak(childId, limit, tenantId);
	const newAchievements = await countMonthAchievements(childId, startDate, endDate, tenantId);

	return {
		childId,
		childName,
		month: yearMonth,
		totalActivities,
		categoryBreakdown: categoryMap,
		avgDailyActivities: totalDays > 0 ? Math.round((totalActivities / totalDays) * 10) / 10 : 0,
		currentLevel: realtimeLevel,
		totalPoints: earnedPoints,
		totalXp: realtimeTotalXp,
		maxStreakDays: streakDays,
		totalNewAchievements: newAchievements,
		daysWithActivity,
		totalDays,
		isFuture,
	};
}

/**
 * 全子供の詳細月次レポートを取得
 */
export async function computeAllChildrenDetailedReport(
	tenantId: string,
	yearMonth: string,
): Promise<DetailedMonthlySummary[]> {
	const repos = getRepos();
	const children = await repos.child.findAllChildren(tenantId);
	const results: DetailedMonthlySummary[] = [];

	for (const child of children) {
		try {
			const report = await computeDetailedMonthlyReport(
				tenantId,
				child.id,
				child.nickname,
				yearMonth,
			);
			results.push(report);
		} catch (e) {
			logger.error('Failed to compute monthly report', {
				context: { tenantId, childId: child.id, error: String(e) },
			});
		}
	}
	return results;
}

// ============================================================
// ヘルパー
// ============================================================

function getMonthEndDate(yearMonth: string): string {
	return monthEndOfKey(yearMonth);
}
