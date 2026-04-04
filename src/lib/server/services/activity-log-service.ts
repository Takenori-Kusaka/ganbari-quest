import {
	CANCEL_WINDOW_MS,
	MASTERY_MILESTONE_LEVELS,
	calcMasteryBonus,
	calcMasteryLevel,
	calcStreakBonus,
	getActivityDisplayName,
	getCategoryById,
	todayDate,
} from '$lib/domain/validation/activity';
import { calcLevelFromXp } from '$lib/domain/validation/status';
import {
	findByChildAndActivity as findMastery,
	upsert as upsertMastery,
} from '$lib/server/db/activity-mastery-repo';
import {
	countActiveActivityLogs,
	countTodayActiveRecords,
	findActivityById,
	findActivityLogById,
	findActivityLogs,
	findChildById,
	findStreakLogs,
	getTodayActivityCountsByChild,
	insertActivityLog,
	insertPointLedger,
	markActivityLogCancelled,
} from '$lib/server/db/activity-repo';
import {
	type UnlockedAchievement,
	checkAndUnlockAchievements,
} from '$lib/server/services/achievement-service';
import { type ComboResult, checkAndGrantCombo } from '$lib/server/services/combo-service';
import { checkMissionCompletion } from '$lib/server/services/daily-mission-service';
import { type LevelUpInfo, updateStatus } from '$lib/server/services/status-service';

/**
 * XP = ポイント統合: 活動で得るポイントがそのままXPとしてカテゴリに蓄積される。
 * STATUS_PER_ACTIVITY は廃止。totalPoints が直接 XP に加算される。
 */

/** 活動記録時のカテゴリXP変化情報 */
export interface XpGainInfo {
	categoryId: number;
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
	id: number;
	childId: number;
	activityId: number;
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
	unlockedAchievements: UnlockedAchievement[];
	comboBonus: ComboResult | null;
	missionComplete: { missionCompleted: boolean; allComplete: boolean; bonusAwarded: number } | null;
	eventMissions: { eventId: number; missionComplete: boolean; eventName: string }[];
	calendarEvents: { eventCode: string; eventName: string; completed: boolean }[];
	autoChallengeCompleted: boolean;
	siblingChallenges: {
		challengeId: number;
		allSiblingsComplete: boolean;
		challengeTitle: string;
	}[];
	focusBonus: { bonusPoints: number } | null;
	levelUp: LevelUpInfo | null;
	xpGain: XpGainInfo;
	customUnlocked: { type: string; name: string; icon: string; bonusPoints: number }[];
	specialReward: { id: number; title: string; points: number; icon: string | null } | null;
}

export interface ActivityLogEntry {
	id: number;
	activityName: string;
	activityIcon: string;
	categoryId: number;
	points: number;
	streakDays: number;
	streakBonus: number;
	recordedAt: string;
}

export interface ActivityLogSummary {
	totalCount: number;
	totalPoints: number;
	byCategory: Record<number, { count: number; points: number }>;
}

/** Record an activity for a child. Enforces daily limit and streak calculation. */
export async function recordActivity(
	childId: number,
	activityId: number,
	tenantId: string,
): Promise<
	| RecordActivityResult
	| { error: 'ALREADY_RECORDED' }
	| { error: 'DAILY_LIMIT_REACHED' }
	| { error: 'NOT_FOUND'; target: string }
> {
	const today = todayDate();

	// Verify child exists
	const child = await findChildById(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND', target: 'child' };

	// Verify activity exists
	const activity = await findActivityById(activityId, tenantId);
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
	const streakBonus = isFirstToday ? calcStreakBonus(streakDays) : 0;

	// 習熟度ボーナス
	const mastery = await findMastery(childId, activityId, tenantId);
	const currentLevel = mastery?.level ?? 1;
	const masteryBonus = calcMasteryBonus(currentLevel);

	const totalPoints = activity.basePoints + streakBonus + masteryBonus;

	// Insert activity log
	const now = new Date().toISOString();
	const log = await insertActivityLog(
		{
			childId,
			activityId,
			points: activity.basePoints,
			streakDays,
			streakBonus,
			recordedDate: today,
			recordedAt: now,
		},
		tenantId,
	);

	// 習熟度更新（count+1 → レベル再計算）
	const newCount = (mastery?.totalCount ?? 0) + 1;
	const newLevel = calcMasteryLevel(newCount);
	const masteryLeveledUp =
		newLevel > currentLevel
			? { oldLevel: currentLevel, newLevel, isMilestone: MASTERY_MILESTONE_LEVELS.has(newLevel) }
			: null;
	await upsertMastery(childId, activityId, newCount, newLevel, tenantId);

	// Insert point ledger entry
	await insertPointLedger(
		{
			childId,
			amount: totalPoints,
			type: 'activity',
			description: `${activity.name}${streakBonus > 0 ? ` (${streakDays}日連続+${streakBonus})` : ''}${masteryBonus > 0 ? ` (習熟Lv.${newLevel}+${masteryBonus})` : ''}`,
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

	// 実績チェック（初回のみ）
	const unlockedAchievements = isFirstToday
		? await checkAndUnlockAchievements(childId, tenantId)
		: [];

	// コンボボーナスチェック
	const comboBonus = await checkAndGrantCombo(childId, today, tenantId);

	// デイリーミッション判定
	const missionResult = await checkMissionCompletion(childId, activityId, tenantId);

	// イベントミッション進捗チェック
	let eventMissionResults: { eventId: number; missionComplete: boolean; eventName: string }[] = [];
	try {
		const { checkEventMissionProgress } = await import('$lib/server/services/season-event-service');
		eventMissionResults = await checkEventMissionProgress(childId, tenantId);
	} catch {
		// イベントミッションチェック失敗は記録フローを止めない
	}

	// シーズンパス進捗チェック
	try {
		const { incrementSeasonPassProgress } = await import(
			'$lib/server/services/seasonal-content-service'
		);
		await incrementSeasonPassProgress(childId, tenantId);
	} catch {
		// シーズンパス進捗失敗は記録フローを止めない
	}

	// カレンダーイベント進捗チェック（新: season-event-calendar ベース）
	let calendarEventResults: { eventCode: string; eventName: string; completed: boolean }[] = [];
	try {
		const { incrementEventProgress } = await import('$lib/server/services/calendar-event-service');
		calendarEventResults = await incrementEventProgress(childId, activity.categoryId, tenantId);
	} catch {
		// カレンダーイベント進捗失敗は記録フローを止めない
	}

	// 自動チャレンジ進捗チェック
	let autoChallengeCompleted = false;
	try {
		const { incrementChallengeProgress } = await import(
			'$lib/server/services/auto-challenge-service'
		);
		const challengeResult = await incrementChallengeProgress(
			childId,
			activity.categoryId,
			tenantId,
		);
		autoChallengeCompleted = challengeResult.challengeCompleted;
	} catch {
		// 自動チャレンジ進捗失敗は記録フローを止めない
	}

	// きょうだいチャレンジ進捗チェック
	let siblingChallengeResults: {
		challengeId: number;
		allSiblingsComplete: boolean;
		challengeTitle: string;
	}[] = [];
	try {
		const { checkChallengeProgress } = await import(
			'$lib/server/services/sibling-challenge-service'
		);
		siblingChallengeResults = await checkChallengeProgress(
			childId,
			activityId,
			activity.categoryId,
			tenantId,
		);
	} catch {
		// きょうだいチャレンジチェック失敗は記録フローを止めない
	}

	// フォーカスモードおすすめ3件達成ボーナスチェック
	let focusBonus: { bonusPoints: number } | null = null;
	try {
		const { checkAndGrantFocusBonus } = await import('$lib/server/services/recommendation-service');
		const { findActivities } = await import('$lib/server/db/activity-repo');
		const { selectRecommendations } = await import('$lib/server/services/recommendation-service');
		const allActivities = await findActivities(tenantId, { childAge: child.age });
		const recs = selectRecommendations(allActivities, today, 3);
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
	} catch {
		// 証明書発行失敗は記録フローを止めない
	}

	// カスタム実績・称号チェック
	let customUnlocked: { type: string; name: string; icon: string; bonusPoints: number }[] = [];
	try {
		const { checkAndUnlockCustomItems } = await import(
			'$lib/server/services/custom-achievement-service'
		);
		const progressData = {
			totalActivityCount: await countActiveActivityLogs(childId, tenantId),
			activityCounts: {
				[activityId]: await countTodayActiveRecords(childId, activityId, today, tenantId),
			},
			categoryCounts: {},
			maxStreakDays: streakDays,
			activityStreaks: { [activityId]: streakDays },
			currentLevel: levelUp ? levelUp.newLevel : xpGain.levelAfter,
			achievementCount: unlockedAchievements.length,
		};
		customUnlocked = await checkAndUnlockCustomItems(childId, tenantId, progressData);
		// カスタム実績ボーナスポイント付与
		for (const item of customUnlocked) {
			if (item.bonusPoints > 0) {
				await insertPointLedger(
					{
						childId,
						amount: item.bonusPoints,
						type: 'custom_achievement',
						description: `カスタム実績「${item.name}」達成ボーナス`,
					},
					tenantId,
				);
			}
		}
	} catch {
		// カスタム実績チェック失敗は記録フローを止めない
	}

	// 固定間隔特別報酬チェック（予告型: 毎N回記録でごほうび）
	let specialReward: { id: number; title: string; points: number; icon: string | null } | null =
		null;
	try {
		const { checkAndGrantFixedIntervalReward } = await import(
			'$lib/server/services/special-reward-service'
		);
		const reward = await checkAndGrantFixedIntervalReward(childId, tenantId);
		if (reward) {
			specialReward = {
				id: reward.id,
				title: reward.title,
				points: reward.points,
				icon: reward.icon,
			};
		}
	} catch {
		// 固定間隔報酬チェック失敗は記録フローを止めない
	}

	return {
		id: log.id,
		childId,
		activityId,
		activityName: getActivityDisplayName(activity, child.age),
		basePoints: activity.basePoints,
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
		autoChallengeCompleted,
		siblingChallenges: siblingChallengeResults,
		focusBonus,
		levelUp,
		xpGain,
		customUnlocked,
		specialReward,
	};
}

/** Cancel an activity record (within cancel window). */
export async function cancelActivityLog(
	logId: number,
	tenantId: string,
): Promise<{ refundedPoints: number } | { error: 'NOT_FOUND' } | { error: 'CANCEL_EXPIRED' }> {
	const log = await findActivityLogById(logId, tenantId);
	if (!log) return { error: 'NOT_FOUND' };
	if (log.cancelled) return { error: 'NOT_FOUND' };

	const recordedTime = new Date(log.recordedAt).getTime();
	if (Date.now() - recordedTime > CANCEL_WINDOW_MS) {
		return { error: 'CANCEL_EXPIRED' };
	}

	const totalPoints = log.points + log.streakBonus;

	// 活動のカテゴリを取得してステータスXPを戻す
	const activity = await findActivityById(log.activityId, tenantId);
	if (activity) {
		await updateStatus(log.childId, activity.categoryId, -totalPoints, 'activity_cancel', tenantId);
	}

	// 習熟度を戻す（count-1、レベル再計算）
	const mastery = await findMastery(log.childId, log.activityId, tenantId);
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
	childId: number,
	tenantId: string,
	options: { from?: string; to?: string } = {},
): Promise<{ logs: ActivityLogEntry[]; summary: ActivityLogSummary }> {
	const rows = await findActivityLogs(childId, tenantId, options);

	// Build summary
	const byCategory: Record<number, { count: number; points: number }> = {};
	let totalCount = 0;
	let totalPoints = 0;

	for (const row of rows) {
		totalCount++;
		const rowTotal = row.points + row.streakBonus;
		totalPoints += rowTotal;

		if (!byCategory[row.categoryId]) {
			byCategory[row.categoryId] = { count: 0, points: 0 };
		}
		const cat = byCategory[row.categoryId];
		if (cat) {
			cat.count++;
			cat.points += rowTotal;
		}
	}

	return {
		logs: rows,
		summary: { totalCount, totalPoints, byCategory },
	};
}

/** Get today's recorded activity counts for a child (for UI completed/badge state). */
export async function getTodayRecordedActivityCounts(
	childId: number,
	tenantId: string,
): Promise<{ activityId: number; count: number }[]> {
	const today = todayDate();
	return await getTodayActivityCountsByChild(childId, today, tenantId);
}

/** Get today's recorded activity IDs for a child (backward-compatible wrapper). */
export async function getTodayRecordedActivityIds(
	childId: number,
	tenantId: string,
): Promise<number[]> {
	return (await getTodayRecordedActivityCounts(childId, tenantId)).map((r) => r.activityId);
}

/** Check if a child has any activity records (for first-time experience detection). */
export async function hasAnyActivityRecords(childId: number, tenantId: string): Promise<boolean> {
	const count = await countActiveActivityLogs(childId, tenantId);
	return count > 0;
}

/** Calculate streak (consecutive days including today). */
async function calculateStreak(
	childId: number,
	activityId: number,
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
	const d = new Date(`${dateStr}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}
