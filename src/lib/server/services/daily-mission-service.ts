// src/lib/server/services/daily-mission-service.ts
// デイリーミッション — 毎日3つのミッションを自動生成し、達成でボーナス付与

import { eq, and, ne, desc, gte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	dailyMissions,
	activities,
	activityLogs,
	pointLedger,
	children,
} from '$lib/server/db/schema';
import { todayDateJST } from '$lib/domain/date-utils';
import { CATEGORIES } from '$lib/domain/validation/activity';

const MISSION_COUNT = 3;

/** ボーナステーブル */
const MISSION_BONUS: Record<number, number> = {
	2: 5,
	3: 20,
};

export interface DailyMission {
	id: number;
	activityId: number;
	activityName: string;
	activityIcon: string;
	category: string;
	completed: boolean;
}

export interface DailyMissionStatus {
	missions: DailyMission[];
	completedCount: number;
	allComplete: boolean;
	bonusAwarded: number;
}

/**
 * 今日のミッションを取得（未生成なら自動生成）
 */
export function getTodayMissions(childId: number): DailyMissionStatus {
	const today = todayDateJST();

	// 既存のミッションを確認
	let missions = db
		.select({
			id: dailyMissions.id,
			activityId: dailyMissions.activityId,
			completed: dailyMissions.completed,
			activityName: activities.name,
			activityIcon: activities.icon,
			category: activities.category,
		})
		.from(dailyMissions)
		.innerJoin(activities, eq(dailyMissions.activityId, activities.id))
		.where(and(eq(dailyMissions.childId, childId), eq(dailyMissions.missionDate, today)))
		.all();

	// なければ生成
	if (missions.length === 0) {
		generateMissions(childId, today);
		missions = db
			.select({
				id: dailyMissions.id,
				activityId: dailyMissions.activityId,
				completed: dailyMissions.completed,
				activityName: activities.name,
				activityIcon: activities.icon,
				category: activities.category,
			})
			.from(dailyMissions)
			.innerJoin(activities, eq(dailyMissions.activityId, activities.id))
			.where(and(eq(dailyMissions.childId, childId), eq(dailyMissions.missionDate, today)))
			.all();
	}

	const completedCount = missions.filter((m) => m.completed === 1).length;

	// 既に付与されたボーナスを確認
	const bonusRecord = db
		.select({ amount: pointLedger.amount })
		.from(pointLedger)
		.where(
			and(
				eq(pointLedger.childId, childId),
				eq(pointLedger.type, 'daily_mission'),
				eq(pointLedger.description, `[${today}] ミッションボーナス`),
			),
		)
		.get();

	return {
		missions: missions.map((m) => ({
			id: m.id,
			activityId: m.activityId,
			activityName: m.activityName,
			activityIcon: m.activityIcon,
			category: m.category,
			completed: m.completed === 1,
		})),
		completedCount,
		allComplete: completedCount >= MISSION_COUNT,
		bonusAwarded: bonusRecord?.amount ?? 0,
	};
}

/**
 * 活動記録時にミッション達成を判定し、ボーナスを付与
 */
export function checkMissionCompletion(
	childId: number,
	activityId: number,
): { missionCompleted: boolean; allComplete: boolean; bonusAwarded: number } {
	const today = todayDateJST();

	// このactivityIdがミッションに含まれるか
	const mission = db
		.select({ id: dailyMissions.id, completed: dailyMissions.completed })
		.from(dailyMissions)
		.where(
			and(
				eq(dailyMissions.childId, childId),
				eq(dailyMissions.missionDate, today),
				eq(dailyMissions.activityId, activityId),
			),
		)
		.get();

	if (!mission || mission.completed === 1) {
		return { missionCompleted: false, allComplete: false, bonusAwarded: 0 };
	}

	// ミッション達成
	db.update(dailyMissions)
		.set({ completed: 1, completedAt: new Date().toISOString() })
		.where(eq(dailyMissions.id, mission.id))
		.run();

	// 全ミッションの達成状況を確認
	const allMissions = db
		.select({ completed: dailyMissions.completed })
		.from(dailyMissions)
		.where(and(eq(dailyMissions.childId, childId), eq(dailyMissions.missionDate, today)))
		.all();

	const completedCount = allMissions.filter((m) => m.completed === 1).length;
	const allComplete = completedCount >= MISSION_COUNT;

	// ボーナス計算（差分付与）
	const bonus = MISSION_BONUS[completedCount] ?? 0;
	let bonusAwarded = 0;

	if (bonus > 0) {
		// 既に付与済みか確認
		const existing = db
			.select({ amount: pointLedger.amount })
			.from(pointLedger)
			.where(
				and(
					eq(pointLedger.childId, childId),
					eq(pointLedger.type, 'daily_mission'),
					eq(pointLedger.description, `[${today}] ミッションボーナス`),
				),
			)
			.get();

		if (!existing) {
			db.insert(pointLedger)
				.values({
					childId,
					amount: bonus,
					type: 'daily_mission',
					description: `[${today}] ミッションボーナス`,
				})
				.run();
			bonusAwarded = bonus;
		} else if (existing.amount < bonus) {
			// 2/3→3/3 のように追加ボーナスが発生
			const diff = bonus - existing.amount;
			db.insert(pointLedger)
				.values({
					childId,
					amount: diff,
					type: 'daily_mission',
					description: `[${today}] ミッションコンプリートボーナス`,
				})
				.run();
			bonusAwarded = diff;
		}
	}

	return { missionCompleted: true, allComplete, bonusAwarded };
}

/**
 * ミッション生成（利用履歴ベースのアルゴリズム）
 *
 * 3枠の配分:
 * 1. 確実枠: 直近7日で記録した活動から（達成しやすい）
 * 2. チャレンジ枠: 過去に記録したが最近やっていない活動から
 * 3. 探検枠: 未経験の活動からランダム（新しい活動への誘導）
 *
 * フォールバック: 履歴が不足する場合はカテゴリ分散のランダム選出
 */
function generateMissions(childId: number, date: string): void {
	const child = db.select().from(children).where(eq(children.id, childId)).get();
	if (!child) return;

	// 対象年齢の表示可能な活動を取得
	const allActivities = db
		.select()
		.from(activities)
		.where(eq(activities.isVisible, 1))
		.all()
		.filter((a) => {
			if (a.ageMin !== null && child.age < a.ageMin) return false;
			if (a.ageMax !== null && child.age > a.ageMax) return false;
			return true;
		});

	if (allActivities.length === 0) return;

	// 前日のミッションを取得（同じ組み合わせを避ける）
	const yesterday = getPreviousDate(date);
	const prevMissions = db
		.select({ activityId: dailyMissions.activityId })
		.from(dailyMissions)
		.where(and(eq(dailyMissions.childId, childId), eq(dailyMissions.missionDate, yesterday)))
		.all();
	const prevIds = new Set(prevMissions.map((m) => m.activityId));

	// 利用履歴を取得
	const sevenDaysAgo = getNDaysAgo(date, 7);
	const recentLogs = db
		.select({ activityId: activityLogs.activityId })
		.from(activityLogs)
		.where(
			and(
				eq(activityLogs.childId, childId),
				gte(activityLogs.recordedDate, sevenDaysAgo),
				eq(activityLogs.cancelled, 0),
			),
		)
		.all();
	const recentActivityIds = new Set(recentLogs.map((l) => l.activityId));

	const allLogs = db
		.select({ activityId: activityLogs.activityId })
		.from(activityLogs)
		.where(and(eq(activityLogs.childId, childId), eq(activityLogs.cancelled, 0)))
		.all();
	const allRecordedIds = new Set(allLogs.map((l) => l.activityId));

	const allActivityIds = new Set(allActivities.map((a) => a.id));

	// 3つのプール分類
	const recentPool = allActivities.filter(
		(a) => recentActivityIds.has(a.id) && !prevIds.has(a.id),
	);
	const challengePool = allActivities.filter(
		(a) => allRecordedIds.has(a.id) && !recentActivityIds.has(a.id) && !prevIds.has(a.id),
	);
	const explorerPool = allActivities.filter(
		(a) => !allRecordedIds.has(a.id) && !prevIds.has(a.id),
	);

	const selected: number[] = [];

	// 1. 確実枠: 直近7日で記録した活動から
	if (recentPool.length > 0) {
		const pick = pickRandom(recentPool);
		if (pick) selected.push(pick.id);
	}

	// 2. チャレンジ枠: 過去に記録したが最近やっていない活動から
	if (challengePool.length > 0 && selected.length < MISSION_COUNT) {
		const remaining = challengePool.filter((a) => !selected.includes(a.id));
		const pick = pickRandom(remaining);
		if (pick) selected.push(pick.id);
	}

	// 3. 探検枠: 未経験の活動からランダム
	if (explorerPool.length > 0 && selected.length < MISSION_COUNT) {
		const remaining = explorerPool.filter((a) => !selected.includes(a.id));
		const pick = pickRandom(remaining);
		if (pick) selected.push(pick.id);
	}

	// フォールバック: 3つに満たない場合、カテゴリ分散でランダム補充
	if (selected.length < MISSION_COUNT) {
		const byCategory = new Map<string, typeof allActivities>();
		for (const a of allActivities) {
			if (selected.includes(a.id)) continue;
			const list = byCategory.get(a.category) ?? [];
			list.push(a);
			byCategory.set(a.category, list);
		}

		// 未選出のカテゴリを優先（カテゴリ分散を保証）
		const selectedCategories = new Set(
			selected
				.map((id) => allActivities.find((a) => a.id === id)?.category)
				.filter(Boolean),
		);
		const unselectedCategories = shuffle(
			CATEGORIES.filter((c) => byCategory.has(c) && !selectedCategories.has(c)),
		);
		const alreadySelectedCategories = shuffle(
			CATEGORIES.filter((c) => byCategory.has(c) && selectedCategories.has(c)),
		);
		const remainingCategories = [...unselectedCategories, ...alreadySelectedCategories];

		for (const cat of remainingCategories) {
			if (selected.length >= MISSION_COUNT) break;
			const catActivities = byCategory.get(cat) ?? [];
			const pool = catActivities.filter((a) => !selected.includes(a.id));
			const pick = pickRandom(pool);
			if (pick) selected.push(pick.id);
		}
	}

	// さらに不足する場合、全活動からランダム補充
	if (selected.length < MISSION_COUNT) {
		const remaining = allActivities.filter((a) => !selected.includes(a.id));
		const shuffled = shuffle(remaining);
		for (const a of shuffled) {
			if (selected.length >= MISSION_COUNT) break;
			selected.push(a.id);
		}
	}

	// DB に挿入
	for (const activityId of selected) {
		db.insert(dailyMissions)
			.values({ childId, missionDate: date, activityId })
			.run();
	}
}

function pickRandom<T>(arr: T[]): T | undefined {
	if (arr.length === 0) return undefined;
	return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j]!, a[i]!];
	}
	return a;
}

function getPreviousDate(dateStr: string): string {
	const d = new Date(dateStr + 'T00:00:00');
	d.setDate(d.getDate() - 1);
	return d.toISOString().slice(0, 10);
}

function getNDaysAgo(dateStr: string, n: number): string {
	const d = new Date(dateStr + 'T00:00:00');
	d.setDate(d.getDate() - n);
	return d.toISOString().slice(0, 10);
}
