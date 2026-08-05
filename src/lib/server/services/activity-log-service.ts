import { monthKeyJST } from '$lib/domain/date-utils';
import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
import {
	CANCEL_WINDOW_MS,
	calcMasteryBonusRefundOnCancel,
	calcMasteryLevel,
	getActivityDisplayName,
	getCategoryById,
	MASTERY_MILESTONE_LEVELS,
	todayDate,
} from '$lib/domain/validation/activity';
import { calcLevelFromXp } from '$lib/domain/validation/status';
import {
	findByChildAndActivity as findMastery,
	upsert as upsertMastery,
} from '$lib/server/db/activity-mastery-repo';
import {
	countActiveActivityLogs,
	findActivityById,
	findActivityLogById,
	getTodayActivityCountsByChild,
	insertActivityLog,
	insertPointLedger,
	markActivityLogCancelled,
} from '$lib/server/db/activity-repo';
// EPIC #3424 Phase Z (#3541): DATA_SOURCE=dsql は core 単一 txn + optional 隔離経路へ dispatch (§8)
import { isDsqlBackend } from '$lib/server/db/backend';
import { cancelActivityDsql } from '$lib/server/services/activity-cancel-dsql';
import {
	type ActivityLogEntry,
	type ActivityLogSummary,
	aggregateActivityLogsByCategory,
} from '$lib/server/services/activity-log-aggregation';
import { recordActivityDsql } from '$lib/server/services/activity-record-dsql';
// 書込前計算 (検証 / streak / mastery / bonus-hook) は sqlite / dsql 両経路の共有 SSOT (#3541)
import { prepareActivityRecord } from '$lib/server/services/activity-record-preparation';
import { type ComboResult, checkAndGrantCombo } from '$lib/server/services/combo-service';
import { checkMissionCompletion } from '$lib/server/services/daily-mission-service';
import { type LevelUpInfo, updateStatus } from '$lib/server/services/status-service';

// Re-export for backward compatibility with existing callers.
export type { ActivityLogEntry, ActivityLogSummary };

/**
 * XP = ポイント統合: 活動で得るポイントがそのままXPとしてカテゴリに蓄積される。
 * STATUS_PER_ACTIVITY は廃止。totalPoints が直接 XP に加算される。
 */

/** 活動記録時のカテゴリXP変化情報 */
export interface XpGainInfo {
	categoryId: CategoryId;
	categoryName: string;
	xpBefore: number;
	xpAfter: number;
	maxValue: number;
	levelBefore: number;
	levelAfter: number;
}

export interface MasteryLevelUpInfo {
	oldLevel: number;
	newLevel: number;
	isMilestone: boolean;
}

export interface RecordActivityResult {
	id: string;
	childId: ChildId;
	activityId: ActivityId;
	activityName: string;
	basePoints: number;
	streakDays: number;
	streakBonus: number;
	masteryBonus: number;
	masteryLevel: number;
	masteryLeveledUp: MasteryLevelUpInfo | null;
	totalPoints: number;
	recordedAt: string;
	cancelableUntil: string;
	unlockedAchievements: {
		code?: string;
		name: string;
		icon: string;
		bonusPoints: number;
		rarity: string;
	}[];
	comboBonus: ComboResult | null;
	missionComplete: { missionCompleted: boolean; allComplete: boolean; bonusAwarded: number } | null;
	eventMissions: { eventId: string; missionComplete: boolean; eventName: string }[];
	calendarEvents: { eventCode: string; eventName: string; completed: boolean }[];
	siblingChallenges: {
		challengeId: string;
		allSiblingsComplete: boolean;
		challengeTitle: string;
	}[];
	focusBonus: { bonusPoints: number } | null;
	levelUp: LevelUpInfo | null;
	xpGain: XpGainInfo;
	customUnlocked: { type: string; name: string; icon: string; bonusPoints: number }[];
}

// ActivityLogEntry / ActivityLogSummary types are defined in activity-log-aggregation.ts
// and re-exported from the module header (see imports above).

/** Record an activity for a child. Enforces daily limit and streak calculation. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
export async function recordActivity(
	childId: ChildId,
	activityId: ActivityId,
	tenantId: string,
): Promise<
	| RecordActivityResult
	| { error: 'ALREADY_RECORDED' }
	| { error: 'DAILY_LIMIT_REACHED' }
	| { error: 'NOT_FOUND'; target: string }
> {
	// EPIC #3424 Phase Z (#3541): DSQL backend は core 単一 txn + optional 隔離の専用経路。
	// sqlite / dynamo / demo は従来経路 (以下) を無変更で通る (現行挙動の凍結)。
	if (isDsqlBackend()) {
		return recordActivityDsql(childId, activityId, tenantId);
	}

	// 書込前計算 (検証 / dailyLimit / streak / mastery / bonus-hook / 倍率) は
	// activity-record-preparation.ts に抽出済 (dsql 経路と共有、#3541。挙動・順序は不変)
	const prep = await prepareActivityRecord(childId, activityId, tenantId);
	if ('error' in prep) return prep;
	const {
		child,
		activity,
		today,
		isFirstToday,
		streakDays,
		streakBonus,
		masteryBonus,
		currentMasteryLevel: currentLevel,
		newMasteryCount: newCount,
		newMasteryLevel: newLevel,
		effectiveBasePoints,
		totalPoints,
		ledgerDescription,
	} = prep;

	// Insert activity log
	const now = new Date().toISOString();
	const log = await insertActivityLog(
		{
			childId,
			activityId,
			points: effectiveBasePoints,
			streakDays,
			streakBonus,
			recordedDate: today,
			recordedAt: now,
		},
		tenantId,
	);

	// 習熟度更新（count+1 → レベル再計算。計算は prepareActivityRecord 済、#3541）
	const masteryLeveledUp =
		newLevel > currentLevel
			? { oldLevel: currentLevel, newLevel, isMilestone: MASTERY_MILESTONE_LEVELS.has(newLevel) }
			: null;
	await upsertMastery(childId, activityId, newCount, newLevel, tenantId);

	// Insert point ledger entry (description は prepareActivityRecord が両経路共通で組み立て済)
	await insertPointLedger(
		{
			childId,
			amount: totalPoints,
			type: 'activity',
			description: ledgerDescription,
			referenceId: log.id,
		},
		tenantId,
	);

	// ステータスを即時更新（XP = ポイント統合）
	const statusResult = await updateStatus(
		childId,
		activity.categoryId,
		totalPoints,
		'activity_record',
		tenantId,
	);
	const levelUp = !('error' in statusResult) && statusResult.levelUp ? statusResult.levelUp : null;

	// XP 変化情報の構築
	const catDef = getCategoryById(activity.categoryId);
	let xpGain: XpGainInfo;
	if (!('error' in statusResult)) {
		const { valueBefore, valueAfter, maxValue } = statusResult;
		const lvBefore = calcLevelFromXp(valueBefore);
		const lvAfter = calcLevelFromXp(valueAfter);
		xpGain = {
			categoryId: activity.categoryId,
			categoryName: catDef?.name ?? '',
			xpBefore: valueBefore,
			xpAfter: valueAfter,
			maxValue,
			levelBefore: lvBefore.level,
			levelAfter: lvAfter.level,
		};
	} else {
		xpGain = {
			categoryId: activity.categoryId,
			categoryName: catDef?.name ?? '',
			xpBefore: 0,
			xpAfter: 0,
			maxValue: 0,
			levelBefore: 1,
			levelAfter: 1,
		};
	}

	const cancelableUntil = new Date(Date.now() + CANCEL_WINDOW_MS).toISOString();

	// 実績システム廃止（#322）— 常に空配列を返す
	const unlockedAchievements: {
		code?: string;
		name: string;
		icon: string;
		bonusPoints: number;
		rarity: string;
	}[] = [];

	// コンボボーナスチェック
	const comboBonus = await checkAndGrantCombo(childId, today, tenantId);

	// デイリーミッション判定
	const missionResult = await checkMissionCompletion(childId, activityId, tenantId);

	// #2295 (EPIC #2294 ①): シーズンイベント / シーズンパス / カレンダーイベント進捗チェック削除済 (2026-05-19)
	// season-event-service / seasonal-content-service / calendar-event-service とも撤去。
	// 後続で参照される空配列は型整合のため宣言だけ残す。
	const eventMissionResults: { eventId: string; missionComplete: boolean; eventName: string }[] =
		[];
	const calendarEventResults: { eventCode: string; eventName: string; completed: boolean }[] = [];

	// per-child チャレンジ進捗チェック (#2458-B: sibling-challenge-service → child-challenge-service)
	// #3213: auto_challenges 廃止。週次自動生成は child_challenges へ一本化され、ここでの進捗更新は
	// updateChildChallengeProgress (per-child instance) のみが担う。
	// 戻り値型: sibling-challenge は `allSiblingsComplete` (group 全員完了) を返したが、
	// per-child instance では自身の completed のみ判定し、group 全員完了は admin/challenges 側で集計する。
	// 上流呼び出し (record action UI) では本配列の各要素を「自身が completed したか」のシグナルのみ使用。
	let siblingChallengeResults: {
		challengeId: string;
		allSiblingsComplete: boolean;
		challengeTitle: string;
	}[] = [];
	try {
		const { updateChildChallengeProgress } = await import(
			'$lib/server/services/child-challenge-service'
		);
		const perChildResults = await updateChildChallengeProgress(
			childId,
			activityId,
			activity.categoryId,
			tenantId,
		);
		// shape adapter: ChallengeCompleted (per-child) → allSiblingsComplete 互換 (自身完了 = 1 件達成)
		// 全兄弟完了演出は SiblingCelebration 側 (home/+page.svelte) で group 集計済の allCompleted を参照するため
		// 本配列では自身 completed の boolean のみ意味を持つ。
		siblingChallengeResults = perChildResults.map((r) => ({
			challengeId: r.challengeId,
			allSiblingsComplete: r.completed,
			challengeTitle: r.challengeTitle,
		}));
	} catch {
		// per-child チャレンジチェック失敗は記録フローを止めない
	}

	// フォーカスモードおすすめ3件達成ボーナスチェック
	// #2458-A1 (ADR-0055): per-child API に migrate。childAge filter は per-child instance では
	// 不要 (instance 化時点で適齢のため)。signature 互換性は `getChildActivities` 側で吸収。
	let focusBonus: { bonusPoints: number } | null = null;
	try {
		const { checkAndGrantFocusBonus } = await import('$lib/server/services/recommendation-service');
		const { getChildActivities } = await import('$lib/server/services/activity-service');
		const { selectRecommendations } = await import('$lib/server/services/recommendation-service');
		const childActs = await getChildActivities(childId, tenantId, { childAge: child.age });
		const recs = selectRecommendations(childActs, today, 3);
		const recIds = recs.map((r) => r.activityId);
		focusBonus = await checkAndGrantFocusBonus(childId, recIds, tenantId);
	} catch {
		// フォーカスボーナスチェック失敗は記録フローを止めない
	}

	// プッシュ通知: 達成通知・レベルアップ通知
	try {
		const { sendAchievementNotification } = await import(
			'$lib/server/services/notification-service'
		);
		await sendAchievementNotification(tenantId, {
			childName: child.nickname,
			activityName: getActivityDisplayName(activity, child.age),
			totalPoints,
			levelUp,
			unlockedAchievements,
		});
	} catch {
		// 通知送信失敗は記録フローを止めない
	}

	// がんばり証明書: ストリーク・レベルアップ・カテゴリマスター自動発行
	try {
		const {
			checkAndIssueStreakCertificates,
			checkAndIssueLevelCertificates,
			issueCategoryMasterCertificate,
			issueMonthlyHabitCertificateIfEligible,
		} = await import('$lib/server/services/certificate-service');
		// ストリーク証明書
		if (isFirstToday && streakDays >= 7) {
			await checkAndIssueStreakCertificates(childId, streakDays, tenantId);
		}
		// レベルアップ証明書
		if (levelUp) {
			await checkAndIssueLevelCertificates(childId, levelUp.newLevel, tenantId);
		}
		// カテゴリマスター証明書（カテゴリ★5 = XPレベル5到達時）
		if (xpGain.levelAfter >= 5 && xpGain.levelBefore < 5 && catDef) {
			await issueCategoryMasterCertificate(childId, String(catDef.id), catDef.name, tenantId);
		}

		// #4172: 月間の習慣化 (その月に記録した日数が閾値以上) を褒める。
		// **1 日 1 回だけ評価する** — 同日 2 回目以降は既に評価済みなので走らせない。
		// 発行は同月の証明書行が冪等キーなので、多重に呼んでも 2 回目以降は no-op。
		if (isFirstToday) {
			await issueMonthlyHabitCertificateIfEligible(childId, monthKeyJST(), tenantId);
		}
	} catch {
		// 証明書発行失敗は記録フローを止めない
	}

	// #1782: カスタム実績機能廃止（ADR-0012 §6 整合 / #404 廃止合意の revert 復活への対応）。
	// 「収集目的の独立 UI / 称号コレクション閲覧ページ / ミッションリスト UI 駆動導線」禁止再宣言に伴い、
	// カスタム実績の解除フック・ボーナスポイント付与 (`type: 'custom_achievement'`) を削除。
	// 既存の point_ledger 履歴は保持される（ただし新規発行は行われない）。
	// 後継機能: チャレンジ機能 (/admin/challenges) のチャレンジ達成 reward。
	const customUnlocked: { type: string; name: string; icon: string; bonusPoints: number }[] = [];

	// #4172: 固定間隔自動ごほうび (活動 5 回ごとに `${n}かいきろく達成！` を棚へ INSERT + 50pt 発行) は撤去。
	// 達成の表現は `value-preview-service.ts` の MILESTONES (初回記録 + 連続日数、報酬を発行しない通知) が担う。
	// #4268: その MILESTONES 側にも残っていた量ベース (5 回 / 10 回) の称賛は撤去済。褒める軸は日数。
	// 撤去理由: 26-ゲーミフィケーション設計書 §2.4「唯一の出口はごほうびショップのみ」/ §2.1-2「親が褒める仕組み」
	// (自動生成行は grantedBy=null で親が一度も関与しない) / §13 実績システム廃止 (#1782 の同型が残っていた)。

	return {
		id: log.id,
		childId,
		activityId,
		activityName: getActivityDisplayName(activity, child.age),
		basePoints: effectiveBasePoints,
		streakDays,
		streakBonus,
		masteryBonus,
		masteryLevel: newLevel,
		masteryLeveledUp,
		totalPoints,
		recordedAt: now,
		cancelableUntil,
		unlockedAchievements,
		comboBonus: comboBonus.totalNewBonus > 0 || comboBonus.hints.length > 0 ? comboBonus : null,
		missionComplete: missionResult.missionCompleted ? missionResult : null,
		eventMissions: eventMissionResults,
		calendarEvents: calendarEventResults,
		siblingChallenges: siblingChallengeResults,
		focusBonus,
		levelUp,
		xpGain,
		customUnlocked,
	};
}

/** Cancel an activity record (within cancel window). */
export async function cancelActivityLog(
	logId: string,
	tenantId: string,
): Promise<{ refundedPoints: number } | { error: 'NOT_FOUND' } | { error: 'CANCEL_EXPIRED' }> {
	// #3596 ②: DSQL backend は cancel core 単一 txn (log-cancel / mastery / ledger+total_point /
	// status / history を all-or-nothing)。sqlite / dynamo / demo は従来の逐次 await 経路 (以下、
	// 現行挙動の凍結)。record 経路 (#3541) と同型の backend 分岐。
	if (isDsqlBackend()) {
		return cancelActivityDsql(logId, tenantId);
	}

	const log = await findActivityLogById(logId, tenantId);
	if (!log) return { error: 'NOT_FOUND' };
	if (log.cancelled) return { error: 'NOT_FOUND' };

	const recordedTime = new Date(log.recordedAt).getTime();
	if (Date.now() - recordedTime > CANCEL_WINDOW_MS) {
		return { error: 'CANCEL_EXPIRED' };
	}

	// #3787: mastery_bonus 対称返金。記録時 ledger / status は base+streak+mastery を計上したため、
	// cancel も同額を返金しないと record→cancel farming で mastery_bonus が balance に残り point 経済が
	// 壊れる。mastery_bonus 額は付与時と同一式 (記録前 level) で再構成する (計算 SSOT = activity.ts)。
	const mastery = await findMastery(log.childId, log.activityId, tenantId);
	const masteryBonusRefund =
		mastery && mastery.totalCount > 0 ? calcMasteryBonusRefundOnCancel(mastery.totalCount) : 0;
	const totalPoints = log.points + log.streakBonus + masteryBonusRefund;

	// 活動のカテゴリを取得してステータスXPを戻す
	const activity = await findActivityById(log.activityId, tenantId);
	if (activity) {
		await updateStatus(log.childId, activity.categoryId, -totalPoints, 'activity_cancel', tenantId);
	}

	// 習熟度を戻す（count-1、レベル再計算）
	if (mastery && mastery.totalCount > 0) {
		const revertedCount = Math.max(0, mastery.totalCount - 1);
		const revertedLevel = calcMasteryLevel(revertedCount);
		await upsertMastery(log.childId, log.activityId, revertedCount, revertedLevel, tenantId);
	}

	// Mark as cancelled
	await markActivityLogCancelled(logId, tenantId);

	// Deduct points
	await insertPointLedger(
		{
			childId: log.childId,
			amount: -totalPoints,
			type: 'cancel',
			description: 'キャンセル',
			referenceId: logId,
		},
		tenantId,
	);

	return { refundedPoints: totalPoints };
}

/** Get activity logs for a child with filtering. */
export async function getActivityLogs(
	childId: ChildId,
	tenantId: string,
	options: { from?: string; to?: string } = {},
): Promise<{ logs: ActivityLogEntry[]; summary: ActivityLogSummary }> {
	// #2097 Fix 2: 集計ロジックは activity-log-aggregation.ts (循環依存解消のため抽出済) に委譲。
	return aggregateActivityLogsByCategory(childId, tenantId, options);
}

/** Get today's recorded activity counts for a child (for UI completed/badge state). */
export async function getTodayRecordedActivityCounts(
	childId: ChildId,
	tenantId: string,
): Promise<{ activityId: ActivityId; count: number }[]> {
	const today = todayDate();
	return await getTodayActivityCountsByChild(childId, today, tenantId);
}

/** Get today's recorded activity IDs for a child (backward-compatible wrapper). */
async function _getTodayRecordedActivityIds(
	childId: ChildId,
	tenantId: string,
): Promise<ActivityId[]> {
	return (await getTodayRecordedActivityCounts(childId, tenantId)).map((r) => r.activityId);
}

/** Check if a child has any activity records (for first-time experience detection). */
export async function hasAnyActivityRecords(childId: ChildId, tenantId: string): Promise<boolean> {
	const count = await countActiveActivityLogs(childId, tenantId);
	return count > 0;
}

// calculateStreak / prevDate は activity-record-preparation.ts へ移設 (#3541、sqlite/dsql 共有)。
