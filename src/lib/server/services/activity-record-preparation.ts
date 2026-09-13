// src/lib/server/services/activity-record-preparation.ts
// EPIC #3424 / 実装 #3541 Phase Z / 設計 SSOT: dsql-data-model.md §8
//
// recordActivity の「書込前 read-only 計算部」を sqlite / dsql 両経路で共有する SSOT。
// 事前 guard (child/activity 存在・所有 CWE-598、dailyLimit 事前判定) と bonus 計算
// (streak / mastery / bonus-hook / メインクエスト×週末倍率) をここに集約し、二重実装を禁止する。
//
// - sqlite 経路 (activity-log-service.ts): 本結果を使って従来どおり逐次書込 (挙動不変)。
// - dsql 経路 (activity-record-dsql.ts): 本結果を RecordActivityCoreInput に写像し、
//   core 5 行を単一 txn で書く (§8)。dailyLimit の正判定は core の txn 内 re-read が担い、
//   ここでの事前判定は「明白な重複を txn 前に弾く」cheap guard に留まる。
//
// 本 module は read-only (書込 API を呼ばない)。書込順序・エラー優先順位
// (NOT_FOUND child → NOT_FOUND activity → ALREADY_RECORDED / DAILY_LIMIT_REACHED) は
// 旧 activity-log-service.ts のインライン実装から変更していない。

import type { RecordActivityFailure } from '$lib/domain/activity-record-failure';
import { prevDateJST } from '$lib/domain/date-utils';
import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
import {
	calcMasteryBonus,
	calcMasteryLevel,
	calcStreakBonus,
	todayDate,
} from '$lib/domain/validation/activity';
import { findByChildAndActivity as findMastery } from '$lib/server/db/activity-mastery-repo';
import {
	countTodayActiveRecords,
	findActivityByIdForChild,
	findChildById,
	findStreakLogs,
	getTodayActivityCountsByChild,
} from '$lib/server/db/activity-repo';
// #2138 MP-3: bonus-hook-service - マーケットプレイス取込済 bonus preset 6 件評価
import { type BonusHit, evaluateBonusHooks } from '$lib/server/services/bonus-hook-service';

/** findChildById の非 null 戻り値 (repo entity 型を再宣言しない)。 */
export type ActivityRecordChild = NonNullable<Awaited<ReturnType<typeof findChildById>>>;
/** findActivityByIdForChild の非 null 戻り値。 */
export type ActivityRecordActivity = NonNullable<
	Awaited<ReturnType<typeof findActivityByIdForChild>>
>;

/** 書込前計算の結果 (read-only)。sqlite / dsql 両経路がこの値から書込を行う。 */
export interface PreparedActivityRecord {
	child: ActivityRecordChild;
	activity: ActivityRecordActivity;
	/** 'YYYY-MM-DD' (JST)。 */
	today: string;
	todayCount: number;
	isFirstToday: boolean;
	streakDays: number;
	/** default streak bonus + bonus-hook 合算。 */
	streakBonus: number;
	/** #4916: streakBonus のうち calcStreakBonus 由来分のみ (内訳表示で bonus-hook hits と分離するため)。 */
	defaultStreakBonus: number;
	/** #4916: bonus-hook-service が評価した個別 hit 一覧 (内訳表示 SSOT。結果ダイアログはこれを itemize する)。 */
	bonusHookHits: BonusHit[];
	masteryBonus: number;
	/** 記録前の習熟レベル (masteryLeveledUp 判定の基準)。 */
	currentMasteryLevel: number;
	/** 記録後の習熟 count (事前 read + 1。dsql 経路の正は core txn 内 re-read)。 */
	newMasteryCount: number;
	/** 記録後の習熟レベル (事前予測。dsql 経路の正は core txn 内 re-read)。 */
	newMasteryLevel: number;
	/** 倍率 (メインクエスト×2 / 週末) 適用後の基礎点。 */
	effectiveBasePoints: number;
	/** effectiveBasePoints + streakBonus + masteryBonus。 */
	totalPoints: number;
	/** point_ledger.description (両経路で同一書式)。 */
	ledgerDescription: string;
}

/**
 * 失敗契約は domain SSOT (`$lib/domain/activity-record-failure`) に集約した。
 * inline union に戻すと、画面側の文言解決が型で結ばれず、コード追加が無警告で
 * 汎用文言に落ちる (= 本 file が守っている「無音の失敗」と同じクラスの退行)。
 */
export type PrepareActivityRecordError = RecordActivityFailure;

/**
 * recordActivity の書込前計算 (検証 → streak → 習熟 → bonus-hook → 倍率 → 合計点)。
 * 旧 activity-log-service.ts recordActivity 前半のインライン実装を無変更で抽出したもの。
 */
export async function prepareActivityRecord(
	childId: ChildId,
	activityId: ActivityId,
	tenantId: string,
): Promise<PreparedActivityRecord | PrepareActivityRecordError> {
	const today = todayDate();

	// Verify child exists
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND', target: 'child' };

	// Verify activity exists AND belongs to this child (CWE-598 / ADR-0055 §3.1 cross-child guard、#2520)。
	// child A の context で child B の child_activities.id を渡す越境を構造的に防ぐ。
	// tenant スコープのみの `findActivityById` ではなく id+child+tenant の 3 軸版を使う。
	const activity = await findActivityByIdForChild(activityId, childId, tenantId);
	if (!activity) return { error: 'NOT_FOUND', target: 'activity' };

	// Count today's active records for this child+activity
	const todayCount = await countTodayActiveRecords(childId, activityId, today, tenantId);

	// Check daily limit: null=1回, 0=無制限, N=N回
	const effectiveLimit = activity.dailyLimit ?? 1;
	if (effectiveLimit !== 0 && todayCount >= effectiveLimit) {
		return effectiveLimit === 1
			? { error: 'ALREADY_RECORDED' as const }
			: { error: 'DAILY_LIMIT_REACHED' as const };
	}

	// Streak: only award on first record of the day
	const isFirstToday = todayCount === 0;
	const streakDays = isFirstToday ? await calculateStreak(childId, activityId, today, tenantId) : 1;
	const defaultStreakBonus = isFirstToday ? calcStreakBonus(streakDays) : 0;

	// 習熟度ボーナス
	const mastery = await findMastery(childId, activityId, tenantId);
	const currentMasteryLevel = mastery?.level ?? 1;
	const masteryBonus = calcMasteryBonus(currentMasteryLevel);

	// #2138 MP-3: bonus-hook-service による 6 件マーケットプレイス bonus 評価
	// (取込済 preset が無ければ totalBonus=0 / pointsMultiplier=1.0 で regression なし)
	// #2458-A1 (ADR-0055): per-child instance API (`getChildActivities`) に migrate。
	// 旧 `findActivities(tenantId)` は tenant aggregate (兄弟全 child の合算) のため、
	// distinct カテゴリ計算が膨らみすぎる UX 退行があった。child scope に絞る。
	let todayDistinctCategoryCount = 0;
	try {
		const todayCounts = await getTodayActivityCountsByChild(childId, today, tenantId);
		const todayActivityIds = new Set(todayCounts.map((c) => c.activityId));
		// 今回記録する activity も含めて distinct カテゴリを数える
		todayActivityIds.add(activityId);
		const { getChildActivities } = await import('$lib/server/services/activity-service');
		const childActivities = await getChildActivities(childId, tenantId, {});
		const todayCategoryIds = new Set<CategoryId>();
		for (const a of childActivities) {
			if (todayActivityIds.has(a.id)) {
				todayCategoryIds.add(a.categoryId);
			}
		}
		todayDistinctCategoryCount = todayCategoryIds.size;
	} catch {
		// distinct カテゴリ計算失敗は bonus hook を no-op で続行
	}

	let hookResult: Awaited<ReturnType<typeof evaluateBonusHooks>> = {
		totalBonus: 0,
		pointsMultiplier: 1.0,
		hits: [],
	};
	try {
		hookResult = await evaluateBonusHooks(
			{
				consecutiveDays: streakDays,
				recordedAt: new Date(),
				todayDistinctCategoryCount,
				isFirstToday,
				categoryId: activity.categoryId,
			},
			tenantId,
		);
	} catch {
		// bonus-hook 失敗は活動記録フローを止めない (regression なし)
	}

	// 合計 streakBonus = default + bonus-hook
	const streakBonus = defaultStreakBonus + hookResult.totalBonus;
	const mainQuestMultiplier = activity.isMainQuest ? 2 : 1;
	const weekendMultiplier = hookResult.pointsMultiplier; // weekend-special で 2.0 等
	const effectiveBasePoints = Math.floor(
		activity.basePoints * mainQuestMultiplier * weekendMultiplier,
	);
	const totalPoints = effectiveBasePoints + streakBonus + masteryBonus;

	// 習熟度更新の事前計算（count+1 → レベル再計算）
	const newMasteryCount = (mastery?.totalCount ?? 0) + 1;
	const newMasteryLevel = calcMasteryLevel(newMasteryCount);

	// point_ledger.description (両経路で同一書式)
	const mainQuestLabel = activity.isMainQuest ? ' (メインクエスト×2)' : '';
	const ledgerDescription = `${activity.name}${mainQuestLabel}${streakBonus > 0 ? ` (${streakDays}日連続+${streakBonus})` : ''}${masteryBonus > 0 ? ` (習熟Lv.${newMasteryLevel}+${masteryBonus})` : ''}`;

	return {
		child,
		activity,
		today,
		todayCount,
		isFirstToday,
		streakDays,
		streakBonus,
		defaultStreakBonus,
		bonusHookHits: hookResult.hits,
		masteryBonus,
		currentMasteryLevel,
		newMasteryCount,
		newMasteryLevel,
		effectiveBasePoints,
		totalPoints,
		ledgerDescription,
	};
}

/** Calculate streak (consecutive days including today). */
async function calculateStreak(
	childId: ChildId,
	activityId: ActivityId,
	today: string,
	tenantId: string,
): Promise<number> {
	// Get all recorded dates for this child+activity, ordered desc
	const rows = await findStreakLogs(childId, activityId, tenantId);

	if (rows.length === 0) return 1; // First time = day 1

	// Check if yesterday is in the list, then day before, etc.
	let streak = 1; // Today counts as day 1
	let checkDate = prevDate(today);

	for (const row of rows) {
		if (row.recordedDate === checkDate) {
			streak++;
			checkDate = prevDate(checkDate);
		} else if (row.recordedDate < checkDate) {
			break; // Gap found
		}
	}

	return streak;
}

/** Get previous date string (YYYY-MM-DD). */
function prevDate(dateStr: string): string {
	return prevDateJST(dateStr);
}

// ============================================================
// #4916: 結果ダイアログ / 履歴の内訳 SSOT
// ============================================================
//
// 記録結果の「+N P」と内訳が食い違う不具合 (Issue #4916) の根治:
//   - streakBonus は default streak (calcStreakBonus) + bonus-hook hits[] の合算値だったが、
//     hits[] 自体は evaluateBonusHooks 内で捨てられ、結果ダイアログには単一の合算値しか
//     出せなかった (どのボーナスがいくら付いたか顧客が追えない)。
//   - combo / mission / focus bonus は totalPoints と別建てで point_ledger に書かれるため、
//     結果ダイアログの主要数字 (totalPoints) が実際の残高増分と一致しないケースがあった。
//
// 本節は「主要数字 = 全ボーナス込みの最終合計、内訳は全ボーナス種別を列挙」という統一ルール
// (Issue #4916 AC) を実現するための共有 builder。sqlite 経路 (activity-log-service.ts) と
// dsql 経路 (activity-record-dsql.ts) の両方から同じ PreparedActivityRecord を渡して呼ぶため、
// 内訳ロジックの二重実装を避けられる。

/** メインクエスト / weekend 等、base points に掛かる倍率の出所。 */
export type PointBreakdownMultiplier =
	| { kind: 'mainQuest' }
	| { kind: 'bonusHook'; title: string; multiplier: number };

export interface PointBreakdownItem {
	kind: 'base' | 'streakDefault' | 'bonusHook' | 'mastery';
	/** kind='bonusHook' のみ: マーケットプレイス preset の rule title (動的テキスト)。 */
	title?: string;
	/** 加算ポイント (kind='base' は倍率適用後の effectiveBasePoints)。 */
	points: number;
	/** kind='base' のみ: 適用された倍率の出所一覧 (メインクエスト×2 / weekend×2 等)。 */
	multipliers?: PointBreakdownMultiplier[];
}

/**
 * PreparedActivityRecord から結果ダイアログ / 履歴向けの内訳リストを組み立てる (pure function)。
 * `items.reduce((sum, i) => sum + i.points, 0) === prep.totalPoints` が常に成り立つ
 * (multiplier は base item の points に既に織り込み済で、別建てで加算しない)。
 */
export function buildPointBreakdown(
	prep: Pick<
		PreparedActivityRecord,
		'activity' | 'effectiveBasePoints' | 'defaultStreakBonus' | 'bonusHookHits' | 'masteryBonus'
	>,
): PointBreakdownItem[] {
	const items: PointBreakdownItem[] = [];

	const multipliers: PointBreakdownMultiplier[] = [];
	if (prep.activity.isMainQuest) multipliers.push({ kind: 'mainQuest' });
	for (const hit of prep.bonusHookHits) {
		if (hit.bonusPoints === 0 && hit.multiplier > 1) {
			multipliers.push({ kind: 'bonusHook', title: hit.ruleTitle, multiplier: hit.multiplier });
		}
	}

	items.push({
		kind: 'base',
		points: prep.effectiveBasePoints,
		...(multipliers.length > 0 ? { multipliers } : {}),
	});

	if (prep.defaultStreakBonus > 0) {
		items.push({ kind: 'streakDefault', points: prep.defaultStreakBonus });
	}

	for (const hit of prep.bonusHookHits) {
		if (hit.bonusPoints > 0) {
			items.push({ kind: 'bonusHook', title: hit.ruleTitle, points: hit.bonusPoints });
		}
	}

	if (prep.masteryBonus > 0) {
		items.push({ kind: 'mastery', points: prep.masteryBonus });
	}

	return items;
}
