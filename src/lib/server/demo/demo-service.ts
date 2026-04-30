/**
 * Demo Mode — Mock service layer
 *
 * Returns pre-computed demo data for read operations.
 * Write operations (record, claim, toggle, etc.) return demo success responses.
 * No DB access, no external API calls.
 */

import { selectDailyEnemy } from '$lib/domain/battle-enemies';
import { scaleEnemyStats } from '$lib/domain/battle-engine';
import { convertToBattleStats, getAgeScaling } from '$lib/domain/battle-stat-calculator';
import type { BattleStats, Enemy } from '$lib/domain/battle-types';
import { DEFAULT_POINT_SETTINGS, type PointSettings } from '$lib/domain/point-display';
import { CATEGORY_DEFS, getActivityDisplayName } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier-types';
import { calcLevelFromXp, calcXpToNextLevel } from '$lib/domain/validation/status';
import type { Activity, Child } from '$lib/server/db/types/index.js';
import { computeMustCompletionBonus } from '$lib/server/services/activity-service';
import type { TodayChecklist } from '$lib/server/services/checklist-service';
import type { DailyMissionStatus } from '$lib/server/services/daily-mission-service';
import type { LoginBonusStatus } from '$lib/server/services/login-bonus-service';
import type { ChildStatus, StatusDetail } from '$lib/server/services/status-service';
import {
	DEMO_ACTIVITIES,
	DEMO_ACTIVITY_LOGS,
	DEMO_CHILDREN,
	DEMO_LOGIN_BONUSES,
	DEMO_POINT_BALANCES,
	getDemoActivitiesForChild,
	getDemoChecklistsForChild,
	getDemoLogsForChild,
	getDemoMissionsForChild,
	getDemoPointBalance,
	getDemoStatusesForChild,
	TODAY,
} from './demo-data.js';

// ============================================================
// Child layout data
// ============================================================

export interface DemoChildLayoutData {
	child: Child | null;
	balance: number;
	level: number;
	levelTitle: string;
	avatarConfig: null;
	allChildren: Child[];
	uiMode: string;
	pointSettings: PointSettings;
}

export function getDemoChildLayoutData(childId: number): DemoChildLayoutData {
	const child = DEMO_CHILDREN.find((c) => c.id === childId) ?? null;

	if (!child) {
		return {
			child: null,
			balance: 0,
			level: 1,
			levelTitle: 'はじめのぼうけんしゃ',
			avatarConfig: null,
			allChildren: DEMO_CHILDREN,
			uiMode: 'preschool',
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
	}

	const statuses = getDemoStatusesForChild(childId);
	let highestXp = 0;
	for (const s of statuses) {
		if (s.totalXp > highestXp) highestXp = s.totalXp;
	}
	const { level, title } = calcLevelFromXp(highestXp);

	return {
		child,
		balance: getDemoPointBalance(childId),
		level,
		levelTitle: title,
		avatarConfig: null,
		allChildren: DEMO_CHILDREN,
		uiMode: child.uiMode ?? 'preschool',
		pointSettings: DEFAULT_POINT_SETTINGS,
	};
}

// ============================================================
// Home page data
// ============================================================

export interface DemoHomeData {
	activities: (Activity & { displayName: string; isMission: boolean })[];
	todayRecorded: { activityId: number; count: number }[];
	loginBonusStatus: LoginBonusStatus | null;
	latestReward: null;
	hasChecklists: boolean;
	checklistProgress: { checkedCount: number; totalCount: number; allDone: boolean } | null;
	dailyMissions: DailyMissionStatus | null;
	/**
	 * #1757 (#1709-C): 「今日のおやくそく」N/M 進捗（demo は in-memory 計算のみ。
	 * granted は本番モード初回付与の可視化用なので demo では常に false）。
	 * - total === 0 の場合は null（バー非表示判定は呼び出し側）
	 * - baby は呼び出し側で除外
	 */
	mustStatus: {
		logged: number;
		total: number;
		allComplete: boolean;
		granted: boolean;
		points: number;
	} | null;
}

export function getDemoHomeData(childId: number): DemoHomeData {
	const child = DEMO_CHILDREN.find((c) => c.id === childId);
	if (!child) {
		return {
			activities: [],
			todayRecorded: [],
			loginBonusStatus: null,
			latestReward: null,
			hasChecklists: false,
			checklistProgress: null,
			dailyMissions: null,
			mustStatus: null,
		};
	}

	const activities = getDemoActivitiesForChild(child.age);
	const missions = getDemoMissionsForChild(childId);
	const missionActivityIds = new Set(missions.map((m) => m.activityId));

	const activitiesWithMission = activities.map((a) => ({
		...a,
		displayName: getActivityDisplayName(a, child.age),
		isMission: missionActivityIds.has(a.id),
	}));

	// Today's recorded counts
	const todayLogs = DEMO_ACTIVITY_LOGS.filter(
		(l) => l.childId === childId && l.recordedDate === TODAY && l.cancelled === 0,
	);
	const countMap = new Map<number, number>();
	for (const log of todayLogs) {
		countMap.set(log.activityId, (countMap.get(log.activityId) ?? 0) + 1);
	}
	const todayRecorded = Array.from(countMap.entries()).map(([activityId, count]) => ({
		activityId,
		count,
	}));

	// Login bonus
	const bonus = DEMO_LOGIN_BONUSES.find((b) => b.childId === childId);
	const loginBonusStatus: LoginBonusStatus | null = bonus
		? {
				childId,
				claimedToday: true,
				consecutiveLoginDays: bonus.consecutiveDays,
				lastClaimedAt: bonus.createdAt,
			}
		: childId === 901
			? null // baby has no login bonus
			: { childId, claimedToday: false, consecutiveLoginDays: 1, lastClaimedAt: null };

	// Checklists
	const { templates, items } = getDemoChecklistsForChild(childId);
	const hasChecklists = templates.length > 0;
	const checklistProgress = hasChecklists
		? {
				checkedCount: Math.floor(items.length * 0.6),
				totalCount: items.length,
				allDone: false,
			}
		: null;

	// Daily missions — enrich with activity names/icons (age-appropriate display)
	let dailyMissions: DailyMissionStatus | null = null;
	if (missions.length > 0) {
		const completedCount = missions.filter((m) => m.completed === 1).length;
		dailyMissions = {
			missions: missions.map((m) => {
				const act = DEMO_ACTIVITIES.find((a) => a.id === m.activityId);
				return {
					id: m.id,
					activityId: m.activityId,
					activityName: act ? getActivityDisplayName(act, child.age) : '不明',
					activityIcon: act?.icon ?? '❓',
					categoryId: act?.categoryId ?? 0,
					completed: m.completed === 1,
				};
			}),
			completedCount,
			allComplete: completedCount === missions.length,
			bonusAwarded: completedCount === missions.length ? 20 : 0,
		};
	}

	// #1757 (#1709-C): 「今日のおやくそく」N/M 集計（demo は in-memory 計算のみ）
	// - baby は呼び出し側で UI 非表示にする（ここでは計算結果のみ返す）
	// - DEMO_ACTIVITIES の priority='must' のうち、子供の age 範囲に合うものを母数とする
	// - 達成 = todayRecorded に含まれる activityId
	const mustActivities = DEMO_ACTIVITIES.filter((a) => {
		if (a.priority !== 'must') return false;
		if (a.isVisible !== 1) return false;
		if (a.isArchived === 1) return false;
		if (a.ageMin !== null && child.age < a.ageMin) return false;
		if (a.ageMax !== null && child.age > a.ageMax) return false;
		return true;
	});
	const recordedSet = new Set(todayRecorded.map((r) => r.activityId));
	const mustLogged = mustActivities.filter((a) => recordedSet.has(a.id)).length;
	const mustTotal = mustActivities.length;
	const mustAllComplete = mustTotal > 0 && mustLogged === mustTotal;
	const uiMode = (child.uiMode ?? 'preschool') as UiMode;
	const mustStatus =
		mustTotal > 0
			? {
					logged: mustLogged,
					total: mustTotal,
					allComplete: mustAllComplete,
					// demo は DB 書き込みなし → granted は常に false（初回演出は本番のみ）
					granted: false,
					points: computeMustCompletionBonus(uiMode, mustAllComplete),
				}
			: null;

	return {
		activities: activitiesWithMission,
		todayRecorded,
		loginBonusStatus,
		latestReward: null,
		hasChecklists,
		checklistProgress,
		dailyMissions,
		mustStatus,
	};
}

// ============================================================
// Status page data
// ============================================================

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
export function getDemoStatusData(childId: number): ChildStatus | null {
	const child = DEMO_CHILDREN.find((c) => c.id === childId);
	if (!child) return null;

	const statuses = getDemoStatusesForChild(childId);
	const statusMap: Record<number, StatusDetail> = {};

	let highestCategoryLevel = 0;
	let totalDeviation = 0;

	for (const catDef of CATEGORY_DEFS) {
		const row = statuses.find((s) => s.categoryId === catDef.id);
		const totalXp = row?.totalXp ?? 0;

		// Simple deviation score for demo (based on XP thresholds)
		const deviationScore = totalXp >= 500 ? 60 : totalXp >= 200 ? 55 : totalXp >= 50 ? 50 : 42;
		const stars =
			deviationScore >= 65
				? 5
				: deviationScore >= 58
					? 4
					: deviationScore >= 50
						? 3
						: deviationScore >= 42
							? 2
							: 1;

		const { level, title } = calcLevelFromXp(totalXp);
		const xpInfo = calcXpToNextLevel(totalXp);

		statusMap[catDef.id] = {
			value: totalXp,
			deviationScore,
			stars,
			trend: totalXp > 100 ? 'up' : 'stable',
			level,
			levelTitle: title,
			expToNextLevel: xpInfo.xpNeeded,
			progressPct: xpInfo.progressPct,
		};

		if (level > highestCategoryLevel) {
			highestCategoryLevel = level;
		}
		totalDeviation += deviationScore;
	}

	const avgDeviation = CATEGORY_DEFS.length > 0 ? totalDeviation / CATEGORY_DEFS.length : 50;

	return {
		childId,
		level: highestCategoryLevel,
		levelTitle: '',
		expToNextLevel: 0,
		maxValue: 100000,
		statuses: statusMap,
		characterType: avgDeviation >= 55 ? 'hero' : avgDeviation >= 45 ? 'normal' : 'ganbari',
		highestCategoryLevel,
	};
}

// ============================================================
// History page data
// ============================================================

export interface DemoHistoryData {
	logs: {
		id: number;
		activityName: string;
		activityIcon: string;
		categoryName: string;
		points: number;
		streakDays: number;
		recordedAt: string;
		recordedDate: string;
	}[];
}

export function getDemoHistoryData(childId: number): DemoHistoryData {
	const child = DEMO_CHILDREN.find((c) => c.id === childId);
	const age = child?.age ?? 6;
	const logs = getDemoLogsForChild(childId);
	return {
		logs: logs
			.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
			.map((l) => {
				const act = DEMO_ACTIVITIES.find((a) => a.id === l.activityId);
				const cat = CATEGORY_DEFS.find((c) => c.id === act?.categoryId);
				return {
					id: l.id,
					activityName: act ? getActivityDisplayName(act, age) : '不明',
					activityIcon: act?.icon ?? '❓',
					categoryName: cat?.name ?? '不明',
					points: l.points,
					streakDays: l.streakDays,
					recordedAt: l.recordedAt,
					recordedDate: l.recordedDate,
				};
			}),
	};
}

// ============================================================
// Admin page data
// ============================================================

export interface DemoAdminData {
	children: Child[];
	activities: Activity[];
	totalLogs: number;
	totalPoints: number;
}

export function getDemoAdminData(): DemoAdminData {
	const totalLogs = DEMO_ACTIVITY_LOGS.filter((l) => l.cancelled === 0).length;
	const totalPoints = Object.values(DEMO_POINT_BALANCES).reduce((s, v) => s + v, 0);
	return {
		children: DEMO_CHILDREN,
		activities: DEMO_ACTIVITIES,
		totalLogs,
		totalPoints,
	};
}

// ============================================================
// Checklist page data
// ============================================================

export function getDemoChecklistData(childId: number) {
	const { templates, items } = getDemoChecklistsForChild(childId);
	return {
		checklists: templates.map((t) => {
			const tItems = items.filter((i) => i.templateId === t.id);
			const checkedCount = Math.floor(tItems.length * 0.6);
			return {
				template: t,
				items: tItems.map((item, idx) => ({
					...item,
					checked: idx < checkedCount,
				})),
				checkedCount,
				totalCount: tItems.length,
				completedAll: checkedCount >= tItems.length,
			};
		}),
	};
}

// #704: 子供画面のチェックリストページ用 — 本番の TodayChecklist と互換性のある形に整形する。
export function getDemoTodayChecklistsForChild(childId: number): TodayChecklist[] {
	const { templates, items } = getDemoChecklistsForChild(childId);
	return templates.map((t) => {
		const tItems = items
			.filter((i) => i.templateId === t.id)
			.sort((a, b) => a.sortOrder - b.sortOrder);
		// デモ表示用にいくつか既にチェック済みの状態を作る（半分程度）
		const initiallyChecked = Math.floor(tItems.length / 2);
		const checked = tItems.map((item, idx) => ({
			id: item.id,
			name: item.name,
			icon: item.icon,
			checked: idx < initiallyChecked,
			source: 'template' as const,
		}));
		const checkedCount = checked.filter((c) => c.checked).length;
		const completedAll = checkedCount === tItems.length && tItems.length > 0;
		return {
			templateId: t.id,
			templateName: t.name,
			templateIcon: t.icon,
			timeSlot: t.timeSlot as 'morning' | 'afternoon' | 'evening' | 'anytime',
			// #1755 (#1709-A): kind 削除 — 持ち物純化
			pointsPerItem: t.pointsPerItem,
			completionBonus: t.completionBonus,
			items: checked,
			checkedCount,
			totalCount: tItems.length,
			completedAll,
			pointsAwarded: completedAll ? tItems.length * t.pointsPerItem + t.completionBonus : 0,
		};
	});
}

// ============================================================
// Battle page data
// ============================================================

export interface DemoBattleData {
	battle: {
		enemy: Enemy;
		playerStats: BattleStats;
		scaledEnemyMaxHp: number;
		completed: false;
		result: null;
	} | null;
}

export function getDemoBattleData(childId: number): DemoBattleData {
	const child = DEMO_CHILDREN.find((c) => c.id === childId);
	if (!child) return { battle: null };

	const statuses = getDemoStatusesForChild(childId);
	const categoryXp: Record<number, number> = {};
	for (const s of statuses) {
		categoryXp[s.categoryId] = s.totalXp;
	}

	const playerStats = convertToBattleStats(categoryXp);
	const dayOfWeek = new Date().getDay();
	const enemy = selectDailyEnemy(dayOfWeek, 0.5, 0);
	const scaling = getAgeScaling(child.uiMode ?? 'preschool');
	const scaledEnemyStats = scaleEnemyStats(enemy.stats, scaling);

	return {
		battle: {
			enemy,
			playerStats,
			scaledEnemyMaxHp: scaledEnemyStats.hp,
			completed: false,
			result: null,
		},
	};
}

// ============================================================
// No-op write operations (demo mode: success without persistence)
// ============================================================

export function demoRecordActivity(activityId: number) {
	const act = DEMO_ACTIVITIES.find((a) => a.id === activityId);
	return {
		success: true,
		logId: 999999,
		activityName: act?.name ?? 'デモ活動',
		totalPoints: (act?.basePoints ?? 10) + 5,
		streakDays: 3,
		streakBonus: 2,
		masteryBonus: 0,
		masteryLevel: 1,
		masteryLeveledUp: null,
		cancelableUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
		unlockedAchievements: [],
		comboBonus: null,
		missionComplete: null,
		levelUp: null,
	};
}

export function demoClaimLoginBonus() {
	return {
		success: true,
		bonusClaimed: true,
		rank: 'kichi',
		basePoints: 5,
		multiplier: 1.5,
		totalPoints: 8,
		consecutiveLoginDays: 3,
	};
}

export function demoCancelRecord() {
	return { success: true, cancelled: true, refundedPoints: 10 };
}

export function demoTogglePin(pinned: boolean) {
	return { success: true, isPinned: pinned };
}

// ============================================================
