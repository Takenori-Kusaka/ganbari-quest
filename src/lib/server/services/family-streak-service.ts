// src/lib/server/services/family-streak-service.ts
// 家族ストリーク — 家族の誰かが毎日記録していれば維持されるストリーク

import { findDistinctRecordedDates } from '$lib/server/db/activity-repo';
import { findAllChildren } from '$lib/server/db/child-repo';

/** 今日の日付を JST で取得 */
function todayDateJST(): string {
	const now = new Date();
	const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
	return jst.toISOString().slice(0, 10);
}

export interface FamilyStreakInfo {
	currentStreak: number;
	hasRecordedToday: boolean;
	todayRecorders: number[]; // childIds who recorded today
	lastRecordedDate: string | null;
}

/**
 * 家族ストリークを計算。
 * 全子供のrecordedDatesをマージし、家族の誰かが記録した日の連続日数を返す。
 */
export async function getFamilyStreak(tenantId: string): Promise<FamilyStreakInfo> {
	const children = await findAllChildren(tenantId);
	if (children.length === 0) {
		return {
			currentStreak: 0,
			hasRecordedToday: false,
			todayRecorders: [],
			lastRecordedDate: null,
		};
	}

	// 全子供の活動日をマージ
	const dateSet = new Set<string>();
	const todayRecorders: number[] = [];
	const today = todayDateJST();

	await Promise.all(
		children.map(async (child) => {
			const dates = await findDistinctRecordedDates(child.id, tenantId);
			for (const d of dates) {
				dateSet.add(d.recordedDate);
			}
			if (dates.some((d) => d.recordedDate === today)) {
				todayRecorders.push(child.id);
			}
		}),
	);

	if (dateSet.size === 0) {
		return {
			currentStreak: 0,
			hasRecordedToday: false,
			todayRecorders: [],
			lastRecordedDate: null,
		};
	}

	const sortedDates = Array.from(dateSet).sort();
	const lastRecordedDate = sortedDates[sortedDates.length - 1] ?? null;
	const hasRecordedToday = todayRecorders.length > 0;

	// 今日 or 昨日から遡って連続日数をカウント
	const todayObj = new Date(`${today}T00:00:00Z`);
	const lastDateObj = lastRecordedDate ? new Date(`${lastRecordedDate}T00:00:00Z`) : null;

	if (!lastDateObj) {
		return { currentStreak: 0, hasRecordedToday, todayRecorders, lastRecordedDate };
	}

	const daysSinceLast = (todayObj.getTime() - lastDateObj.getTime()) / (1000 * 60 * 60 * 24);
	if (daysSinceLast > 1) {
		return { currentStreak: 0, hasRecordedToday, todayRecorders, lastRecordedDate };
	}

	let streak = 1;
	for (let i = sortedDates.length - 2; i >= 0; i--) {
		const curr = new Date(`${sortedDates[i + 1]}T00:00:00Z`);
		const prev = new Date(`${sortedDates[i]}T00:00:00Z`);
		const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
		if (diffDays === 1) {
			streak++;
		} else {
			break;
		}
	}

	return { currentStreak: streak, hasRecordedToday, todayRecorders, lastRecordedDate };
}

/** ストリークボーナスのマイルストーン */
const STREAK_MILESTONES: { days: number; points: number }[] = [
	{ days: 7, points: 50 },
	{ days: 14, points: 100 },
	{ days: 30, points: 200 },
	{ days: 60, points: 300 },
	{ days: 100, points: 500 },
];

/** 指定ストリーク日数で到達するマイルストーンを取得（まだ付与していないもの判定用） */
export function getStreakMilestone(streakDays: number): { days: number; points: number } | null {
	return STREAK_MILESTONES.find((m) => m.days === streakDays) ?? null;
}

/** 次のマイルストーンまでの残り日数 */
export function getNextMilestone(
	streakDays: number,
): { days: number; points: number; remaining: number } | null {
	const next = STREAK_MILESTONES.find((m) => m.days > streakDays);
	if (!next) return null;
	return { ...next, remaining: next.days - streakDays };
}
