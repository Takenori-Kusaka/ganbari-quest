// src/lib/server/services/daily-mission-service.ts
// デイリーミッション — 毎日3つのミッションを自動生成し、達成でボーナス付与

import { todayDateJST } from '$lib/domain/date-utils';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { insertPointLedger } from '$lib/server/db/activity-repo';
import {
	findAllMissionStatuses,
	findAllRecordedActivityIds,
	findChildForMission,
	findMissionBonusRecord,
	findMissionByActivity,
	findPreviousDayMissionIds,
	findRecentActivityIds,
	findTodayMissions,
	findVisibleActivities,
	insertDailyMission,
	markMissionCompleted,
} from '$lib/server/db/daily-mission-repo';

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
	categoryId: number;
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
export async function getTodayMissions(
	childId: number,
	tenantId: string,
): Promise<DailyMissionStatus> {
	const today = todayDateJST();

	// 既存のミッションを確認
	let missions = await findTodayMissions(childId, today, tenantId);

	// なければ生成
	if (missions.length === 0) {
		await generateMissions(childId, today, tenantId);
		missions = await findTodayMissions(childId, today, tenantId);
	}

	const completedCount = missions.filter((m) => m.completed === 1).length;

	// 既に付与されたボーナスを確認
	const bonusRecord = await findMissionBonusRecord(
		childId,
		`[${today}] ミッションボーナス`,
		tenantId,
	);

	return {
		missions: missions.map((m) => ({
			id: m.id,
			activityId: m.activityId,
			activityName: m.activityName,
			activityIcon: m.activityIcon,
			categoryId: m.categoryId,
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
export async function checkMissionCompletion(
	childId: number,
	activityId: number,
	tenantId: string,
): Promise<{ missionCompleted: boolean; allComplete: boolean; bonusAwarded: number }> {
	const today = todayDateJST();

	// このactivityIdがミッションに含まれるか
	const mission = await findMissionByActivity(childId, today, activityId, tenantId);

	if (!mission || mission.completed === 1) {
		return { missionCompleted: false, allComplete: false, bonusAwarded: 0 };
	}

	// ミッション達成
	await markMissionCompleted(mission.id, tenantId);

	// 全ミッションの達成状況を確認
	const allMissions = await findAllMissionStatuses(childId, today, tenantId);

	const completedCount = allMissions.filter((m) => m.completed === 1).length;
	const allComplete = completedCount >= MISSION_COUNT;

	// ボーナス計算（差分付与）
	const bonus = MISSION_BONUS[completedCount] ?? 0;
	let bonusAwarded = 0;

	if (bonus > 0) {
		// 既に付与済みか確認
		const existing = await findMissionBonusRecord(
			childId,
			`[${today}] ミッションボーナス`,
			tenantId,
		);

		if (!existing) {
			await insertPointLedger(
				{
					childId,
					amount: bonus,
					type: 'daily_mission',
					description: `[${today}] ミッションボーナス`,
				},
				tenantId,
			);
			bonusAwarded = bonus;
		} else if (existing.amount < bonus) {
			// 2/3→3/3 のように追加ボーナスが発生
			const diff = bonus - existing.amount;
			await insertPointLedger(
				{
					childId,
					amount: diff,
					type: 'daily_mission',
					description: `[${today}] ミッションコンプリートボーナス`,
				},
				tenantId,
			);
			bonusAwarded = diff;
		}
	}

	return { missionCompleted: true, allComplete, bonusAwarded };
}

/**
 * ミッション生成（利用履歴ベースのアルゴリズム）
 */
async function generateMissions(childId: number, date: string, tenantId: string): Promise<void> {
	const child = await findChildForMission(childId, tenantId);
	if (!child) return;

	// 対象年齢の表示可能な活動を取得
	const allVisibleActivities = await findVisibleActivities(tenantId);
	const allActivities = allVisibleActivities.filter((a) => {
		if (a.ageMin !== null && child.age < a.ageMin) return false;
		if (a.ageMax !== null && child.age > a.ageMax) return false;
		return true;
	});

	if (allActivities.length === 0) return;

	// 前日のミッションを取得（同じ組み合わせを避ける）
	const yesterday = getPreviousDate(date);
	const prevIds = new Set(await findPreviousDayMissionIds(childId, yesterday, tenantId));

	// 利用履歴を取得
	const sevenDaysAgo = getNDaysAgo(date, 7);
	const recentActivityIds = new Set(await findRecentActivityIds(childId, sevenDaysAgo, tenantId));
	const allRecordedIds = new Set(await findAllRecordedActivityIds(childId, tenantId));

	// 3つのプール分類
	const recentPool = allActivities.filter((a) => recentActivityIds.has(a.id) && !prevIds.has(a.id));
	const challengePool = allActivities.filter(
		(a) => allRecordedIds.has(a.id) && !recentActivityIds.has(a.id) && !prevIds.has(a.id),
	);
	const explorerPool = allActivities.filter((a) => !allRecordedIds.has(a.id) && !prevIds.has(a.id));

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
		const byCategory = new Map<number, typeof allActivities>();
		for (const a of allActivities) {
			if (selected.includes(a.id)) continue;
			const list = byCategory.get(a.categoryId) ?? [];
			list.push(a);
			byCategory.set(a.categoryId, list);
		}

		// 未選出のカテゴリを優先（カテゴリ分散を保証）
		const selectedCategoryIds = new Set(
			selected
				.map((id) => allActivities.find((a) => a.id === id)?.categoryId)
				.filter((v): v is number => v != null),
		);
		const allCategoryIds = CATEGORY_DEFS.map((c) => c.id);
		const unselectedCategories = shuffle(
			allCategoryIds.filter((cid) => byCategory.has(cid) && !selectedCategoryIds.has(cid)),
		);
		const alreadySelectedCategories = shuffle(
			allCategoryIds.filter((cid) => byCategory.has(cid) && selectedCategoryIds.has(cid)),
		);
		const remainingCategories = [...unselectedCategories, ...alreadySelectedCategories];

		for (const catId of remainingCategories) {
			if (selected.length >= MISSION_COUNT) break;
			const catActivities = byCategory.get(catId) ?? [];
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
		await insertDailyMission(childId, date, activityId, tenantId);
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
		[a[i], a[j]] = [a[j] as T, a[i] as T];
	}
	return a;
}

function getPreviousDate(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00`);
	d.setDate(d.getDate() - 1);
	return d.toISOString().slice(0, 10);
}

function getNDaysAgo(dateStr: string, n: number): string {
	const d = new Date(`${dateStr}T00:00:00`);
	d.setDate(d.getDate() - n);
	return d.toISOString().slice(0, 10);
}
