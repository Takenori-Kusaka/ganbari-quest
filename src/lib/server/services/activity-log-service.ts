import { eq, and, desc, sql, gte, lte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { activityLogs, activities, pointLedger, children } from '$lib/server/db/schema';
import {
	calcStreakBonus,
	todayDate,
	CANCEL_WINDOW_MS,
	getActivityDisplayName,
} from '$lib/domain/validation/activity';
import { logger } from '$lib/server/logger';
import {
	checkAndUnlockAchievements,
	type UnlockedAchievement,
} from '$lib/server/services/achievement-service';
import { updateStatus, type LevelUpInfo } from '$lib/server/services/status-service';
import { checkAndGrantCombo, type ComboResult } from '$lib/server/services/combo-service';
import { checkMissionCompletion } from '$lib/server/services/daily-mission-service';

/** 1回の活動記録あたりのステータス増加量 */
const STATUS_PER_ACTIVITY = 0.3;

export interface RecordActivityResult {
	id: number;
	childId: number;
	activityId: number;
	activityName: string;
	basePoints: number;
	streakDays: number;
	streakBonus: number;
	totalPoints: number;
	recordedAt: string;
	cancelableUntil: string;
	unlockedAchievements: UnlockedAchievement[];
	comboBonus: ComboResult | null;
	missionComplete: { missionCompleted: boolean; allComplete: boolean; bonusAwarded: number } | null;
	levelUp: LevelUpInfo | null;
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
export function recordActivity(
	childId: number,
	activityId: number,
):
	| RecordActivityResult
	| { error: 'ALREADY_RECORDED' }
	| { error: 'DAILY_LIMIT_REACHED' }
	| { error: 'NOT_FOUND'; target: string } {
	const today = todayDate();

	// Verify child exists
	const child = db.select().from(children).where(eq(children.id, childId)).get();
	if (!child) return { error: 'NOT_FOUND', target: 'child' };

	// Verify activity exists
	const activity = db.select().from(activities).where(eq(activities.id, activityId)).get();
	if (!activity) return { error: 'NOT_FOUND', target: 'activity' };

	// Count today's active records for this child+activity
	const todayRecords = db
		.select()
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.activityId, activityId),
				eq(activityLogs.recordedDate, today),
				eq(activityLogs.cancelled, 0),
			),
		)
		.all();
	const todayCount = todayRecords.length;

	// Check daily limit: null=1回, 0=無制限, N=N回
	const effectiveLimit = activity.dailyLimit ?? 1;
	if (effectiveLimit !== 0 && todayCount >= effectiveLimit) {
		return effectiveLimit === 1
			? { error: 'ALREADY_RECORDED' as const }
			: { error: 'DAILY_LIMIT_REACHED' as const };
	}

	// Streak: only award on first record of the day
	const isFirstToday = todayCount === 0;
	const streakDays = isFirstToday ? calculateStreak(childId, activityId, today) : 1;
	const streakBonus = isFirstToday ? calcStreakBonus(streakDays) : 0;
	const totalPoints = activity.basePoints + streakBonus;

	// Insert activity log
	const now = new Date().toISOString();
	const log = db
		.insert(activityLogs)
		.values({
			childId,
			activityId,
			points: activity.basePoints,
			streakDays,
			streakBonus,
			recordedDate: today,
			recordedAt: now,
		})
		.returning()
		.get();

	// Insert point ledger entry
	db.insert(pointLedger)
		.values({
			childId,
			amount: totalPoints,
			type: 'activity',
			description: `${activity.name}${streakBonus > 0 ? ` (${streakDays}日連続+${streakBonus})` : ''}`,
			referenceId: log.id,
		})
		.run();

	// ステータスを即時更新（カテゴリに対応するステータスを増加）
	const statusResult = updateStatus(childId, activity.categoryId, STATUS_PER_ACTIVITY, 'activity_record');
	const levelUp = (!('error' in statusResult) && statusResult.levelUp) ? statusResult.levelUp : null;

	const cancelableUntil = new Date(Date.now() + CANCEL_WINDOW_MS).toISOString();

	// 実績チェック（初回のみ）
	const unlockedAchievements = isFirstToday ? checkAndUnlockAchievements(childId) : [];

	// コンボボーナスチェック
	const comboBonus = checkAndGrantCombo(childId, today);

	// デイリーミッション判定
	const missionResult = checkMissionCompletion(childId, activityId);

	return {
		id: log.id,
		childId,
		activityId,
		activityName: getActivityDisplayName(activity, child.age),
		basePoints: activity.basePoints,
		streakDays,
		streakBonus,
		totalPoints,
		recordedAt: now,
		cancelableUntil,
		unlockedAchievements,
		comboBonus:
			comboBonus.totalNewBonus > 0 || comboBonus.hints.length > 0 ? comboBonus : null,
		missionComplete: missionResult.missionCompleted ? missionResult : null,
		levelUp,
	};
}

/** Cancel an activity record (within cancel window). */
export function cancelActivityLog(
	logId: number,
): { refundedPoints: number } | { error: 'NOT_FOUND' } | { error: 'CANCEL_EXPIRED' } {
	const log = db.select().from(activityLogs).where(eq(activityLogs.id, logId)).get();
	if (!log) return { error: 'NOT_FOUND' };
	if (log.cancelled) return { error: 'NOT_FOUND' };

	const recordedTime = new Date(log.recordedAt).getTime();
	if (Date.now() - recordedTime > CANCEL_WINDOW_MS) {
		return { error: 'CANCEL_EXPIRED' };
	}

	const totalPoints = log.points + log.streakBonus;

	// 活動のカテゴリを取得してステータスを戻す
	const activity = db.select().from(activities).where(eq(activities.id, log.activityId)).get();
	if (activity) {
		updateStatus(log.childId, activity.categoryId, -STATUS_PER_ACTIVITY, 'activity_cancel');
	}

	// Mark as cancelled
	db.update(activityLogs).set({ cancelled: 1 }).where(eq(activityLogs.id, logId)).run();

	// Deduct points
	db.insert(pointLedger)
		.values({
			childId: log.childId,
			amount: -totalPoints,
			type: 'cancel',
			description: 'キャンセル',
			referenceId: logId,
		})
		.run();

	return { refundedPoints: totalPoints };
}

/** Get activity logs for a child with filtering. */
export function getActivityLogs(
	childId: number,
	options: { from?: string; to?: string } = {},
): { logs: ActivityLogEntry[]; summary: ActivityLogSummary } {
	const conditions = [
		eq(activityLogs.childId, childId),
		eq(activityLogs.cancelled, 0),
	];

	if (options.from) {
		conditions.push(gte(activityLogs.recordedDate, options.from));
	}
	if (options.to) {
		conditions.push(lte(activityLogs.recordedDate, options.to));
	}

	const rows = db
		.select({
			id: activityLogs.id,
			activityName: activities.name,
			activityIcon: activities.icon,
			categoryId: activities.categoryId,
			points: activityLogs.points,
			streakDays: activityLogs.streakDays,
			streakBonus: activityLogs.streakBonus,
			recordedAt: activityLogs.recordedAt,
		})
		.from(activityLogs)
		.innerJoin(activities, eq(activityLogs.activityId, activities.id))
		.where(and(...conditions))
		.orderBy(desc(activityLogs.recordedAt))
		.all();

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
		const cat = byCategory[row.categoryId]!;
		cat.count++;
		cat.points += rowTotal;
	}

	return {
		logs: rows,
		summary: { totalCount, totalPoints, byCategory },
	};
}

/** Get today's recorded activity counts for a child (for UI completed/badge state). */
export function getTodayRecordedActivityCounts(
	childId: number,
): { activityId: number; count: number }[] {
	const today = todayDate();
	const rows = db
		.select({
			activityId: activityLogs.activityId,
			count: sql<number>`count(*)`.as('count'),
		})
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.recordedDate, today),
				eq(activityLogs.cancelled, 0),
			),
		)
		.groupBy(activityLogs.activityId)
		.all();

	return rows;
}

/** Get today's recorded activity IDs for a child (backward-compatible wrapper). */
export function getTodayRecordedActivityIds(childId: number): number[] {
	return getTodayRecordedActivityCounts(childId).map((r) => r.activityId);
}

/** Calculate streak (consecutive days including today). */
function calculateStreak(childId: number, activityId: number, today: string): number {
	// Get all recorded dates for this child+activity, ordered desc
	const rows = db
		.select({ recordedDate: activityLogs.recordedDate })
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				eq(activityLogs.activityId, activityId),
				eq(activityLogs.cancelled, 0),
			),
		)
		.orderBy(desc(activityLogs.recordedDate))
		.all();

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
	const d = new Date(dateStr + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}
