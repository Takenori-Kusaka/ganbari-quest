/**
 * Demo Mode — Mock service layer
 *
 * Returns pre-computed demo data for read operations.
 * Write operations (record, claim, toggle, etc.) return demo success responses.
 * No DB access, no external API calls.
 */

import { DEFAULT_POINT_SETTINGS, type PointSettings } from '$lib/domain/point-display';
import { CATEGORY_DEFS, getActivityDisplayName } from '$lib/domain/validation/activity';
import {
	calcCategoryExpToNextLevel,
	calcCategoryLevel,
	calcLevel,
	getMaxForAge,
} from '$lib/domain/validation/status';
import type { Activity, Child } from '$lib/server/db/types/index.js';
import type { AchievementWithStatus } from '$lib/server/services/achievement-service';
import type { AvatarConfig } from '$lib/server/services/avatar-service';
import type { DailyMissionStatus } from '$lib/server/services/daily-mission-service';
import type { LoginBonusStatus } from '$lib/server/services/login-bonus-service';
import type { ChildStatus, StatusDetail } from '$lib/server/services/status-service';
import type { ActiveTitleInfo, TitleWithStatus } from '$lib/server/services/title-service';

import {
	DEMO_ACTIVITIES,
	DEMO_ACTIVITY_LOGS,
	DEMO_CAREER_FIELDS,
	DEMO_CAREER_PLAN,
	DEMO_CHILDREN,
	DEMO_LOGIN_BONUSES,
	DEMO_POINT_BALANCES,
	TODAY,
	getDemoAchievementsForChild,
	getDemoActivitiesForChild,
	getDemoChecklistsForChild,
	getDemoLogsForChild,
	getDemoMissionsForChild,
	getDemoPointBalance,
	getDemoStatusesForChild,
	getDemoTitlesForChild,
} from './demo-data.js';

// ============================================================
// Demo title definitions (global master, normally from DB)
// ============================================================

const DEMO_TITLES = [
	{
		id: 1,
		code: 'first_step',
		name: 'はじめの一歩',
		description: '最初のきろくを達成',
		icon: '👣',
		conditionType: 'total_logs',
		conditionValue: 1,
		rarity: 'common',
		sortOrder: 1,
		createdAt: '',
	},
	{
		id: 2,
		code: 'adventurer',
		name: 'ぼうけんしゃ',
		description: '活動を10回記録',
		icon: '🗡️',
		conditionType: 'total_logs',
		conditionValue: 10,
		rarity: 'common',
		sortOrder: 2,
		createdAt: '',
	},
	{
		id: 3,
		code: 'warrior',
		name: 'つよきせんし',
		description: 'ステータスが平均50以上',
		icon: '⚔️',
		conditionType: 'avg_status',
		conditionValue: 50,
		rarity: 'rare',
		sortOrder: 3,
		createdAt: '',
	},
	{
		id: 4,
		code: 'hero',
		name: 'ゆうしゃ',
		description: 'レベル5に到達',
		icon: '🦸',
		conditionType: 'level',
		conditionValue: 5,
		rarity: 'epic',
		sortOrder: 4,
		createdAt: '',
	},
	{
		id: 5,
		code: 'legend',
		name: 'でんせつ',
		description: 'レベル8に到達',
		icon: '👑',
		conditionType: 'level',
		conditionValue: 8,
		rarity: 'legendary',
		sortOrder: 5,
		createdAt: '',
	},
];

// ============================================================
// Demo achievement definitions (global master, normally from DB)
// ============================================================

const DEMO_ACHIEVEMENTS = [
	{
		id: 1,
		code: 'first_log',
		name: 'はじめてのきろく',
		description: '初めて活動を記録した',
		icon: '📝',
		category: null,
		conditionType: 'total_logs',
		conditionValue: 1,
		bonusPoints: 10,
		rarity: 'common',
		sortOrder: 1,
		repeatable: 0,
		isMilestone: 0,
		milestoneValues: null,
		createdAt: '',
	},
	{
		id: 2,
		code: 'log_count',
		name: 'きろくの達人',
		description: '活動記録の回数マイルストーン',
		icon: '📊',
		category: null,
		conditionType: 'total_logs',
		conditionValue: 10,
		bonusPoints: 50,
		rarity: 'rare',
		sortOrder: 2,
		repeatable: 1,
		isMilestone: 1,
		milestoneValues: '[10,50,100,200,500]',
		createdAt: '',
	},
	{
		id: 3,
		code: 'streak_7',
		name: '7日れんぞく',
		description: '7日間連続で記録した',
		icon: '🔥',
		category: null,
		conditionType: 'streak_days',
		conditionValue: 7,
		bonusPoints: 30,
		rarity: 'rare',
		sortOrder: 3,
		repeatable: 0,
		isMilestone: 0,
		milestoneValues: null,
		createdAt: '',
	},
	{
		id: 4,
		code: 'all_category',
		name: 'オールラウンダー',
		description: '全カテゴリで記録した',
		icon: '🌈',
		category: null,
		conditionType: 'category_count',
		conditionValue: 5,
		bonusPoints: 100,
		rarity: 'epic',
		sortOrder: 4,
		repeatable: 0,
		isMilestone: 0,
		milestoneValues: null,
		createdAt: '',
	},
	{
		id: 5,
		code: 'level_5',
		name: 'レベル5到達',
		description: 'レベル5に到達した',
		icon: '⭐',
		category: null,
		conditionType: 'level',
		conditionValue: 5,
		bonusPoints: 200,
		rarity: 'epic',
		sortOrder: 5,
		repeatable: 0,
		isMilestone: 0,
		milestoneValues: null,
		createdAt: '',
	},
];

// ============================================================
// Child layout data
// ============================================================

export interface DemoChildLayoutData {
	child: Child | null;
	balance: number;
	level: number;
	levelTitle: string;
	activeTitle: ActiveTitleInfo | null;
	avatarConfig: AvatarConfig;
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
			activeTitle: null,
			avatarConfig: defaultAvatarConfig(),
			allChildren: DEMO_CHILDREN,
			uiMode: 'kinder',
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
	}

	const statuses = getDemoStatusesForChild(childId);
	const maxValue = getMaxForAge(child.age);
	let totalValue = 0;
	for (const s of statuses) {
		totalValue += s.value;
	}
	const avgStatus = statuses.length > 0 ? totalValue / statuses.length : 0;
	const normalizedAvg = maxValue > 0 ? (avgStatus / maxValue) * 100 : 0;
	const { level, title } = calcLevel(normalizedAvg);

	const titleUnlocks = getDemoTitlesForChild(childId);
	const activeTitleId = child.activeTitleId;
	let activeTitle: ActiveTitleInfo | null = null;
	if (activeTitleId) {
		const titleDef = DEMO_TITLES.find((t) => t.id === activeTitleId);
		if (titleDef && titleUnlocks.some((u) => u.titleId === activeTitleId)) {
			activeTitle = {
				id: titleDef.id,
				name: titleDef.name,
				icon: titleDef.icon,
				rarity: titleDef.rarity,
			};
		}
	}

	return {
		child,
		balance: getDemoPointBalance(childId),
		level,
		levelTitle: title,
		activeTitle,
		avatarConfig: defaultAvatarConfig(),
		allChildren: DEMO_CHILDREN,
		uiMode: child.uiMode ?? 'kinder',
		pointSettings: DEFAULT_POINT_SETTINGS,
	};
}

function defaultAvatarConfig(): AvatarConfig {
	return {
		bgCss: '',
		frameCss: '',
		effectClass: '',
		customSoundPath: null,
		celebrationEffect: '',
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
	birthdayStatus: null;
	healthCheckItems: { key: string; label: string; icon: string }[];
	dailyMissions: DailyMissionStatus | null;
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
			birthdayStatus: null,
			healthCheckItems: [],
			dailyMissions: null,
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

	// Daily missions — enrich with activity names/icons
	let dailyMissions: DailyMissionStatus | null = null;
	if (missions.length > 0) {
		const completedCount = missions.filter((m) => m.completed === 1).length;
		dailyMissions = {
			missions: missions.map((m) => {
				const act = DEMO_ACTIVITIES.find((a) => a.id === m.activityId);
				return {
					id: m.id,
					activityId: m.activityId,
					activityName: act?.name ?? '不明',
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

	return {
		activities: activitiesWithMission,
		todayRecorded,
		loginBonusStatus,
		latestReward: null,
		hasChecklists,
		checklistProgress,
		birthdayStatus: null,
		healthCheckItems: [
			{ key: 'no_injury', label: 'おおきなけがをしなかった', icon: '🩹' },
			{ key: 'no_cold', label: 'かぜをあまりひかなかった', icon: '🤧' },
			{ key: 'played_outside', label: 'たくさんそとであそんだ', icon: '🌞' },
			{ key: 'ate_well', label: 'すききらいなくたべられた', icon: '🍽️' },
			{ key: 'slept_well', label: 'はやねはやおきができた', icon: '😴' },
		],
		dailyMissions,
	};
}

// ============================================================
// Status page data
// ============================================================

export function getDemoStatusData(childId: number): ChildStatus | null {
	const child = DEMO_CHILDREN.find((c) => c.id === childId);
	if (!child) return null;

	const statuses = getDemoStatusesForChild(childId);
	const maxValue = getMaxForAge(child.age);
	const statusMap: Record<number, StatusDetail> = {};

	let highestCategoryLevel = 0;
	let totalDeviation = 0;

	for (const catDef of CATEGORY_DEFS) {
		const row = statuses.find((s) => s.categoryId === catDef.id);
		const value = row?.value ?? 0;
		// Simple deviation score based on value/maxValue
		const normalized = maxValue > 0 ? (value / maxValue) * 100 : 0;
		const deviationScore = Math.round(normalized * 0.3 + 35); // Maps 0-100 → 35-65
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

		const catLevel = calcCategoryLevel(value, maxValue);
		const catExp = calcCategoryExpToNextLevel(value, maxValue);

		statusMap[catDef.id] = {
			value: Math.round(value * 10) / 10,
			deviationScore,
			stars,
			trend: value > maxValue * 0.3 ? 'up' : 'stable',
			level: catLevel.level,
			levelTitle: catLevel.title,
			expToNextLevel: Math.round(catExp * 10) / 10,
		};

		if (catLevel.level > highestCategoryLevel) {
			highestCategoryLevel = catLevel.level;
		}
		totalDeviation += deviationScore;
	}

	const avgDeviation = CATEGORY_DEFS.length > 0 ? totalDeviation / CATEGORY_DEFS.length : 50;

	return {
		childId,
		level: highestCategoryLevel,
		levelTitle: '',
		expToNextLevel: 0,
		maxValue,
		statuses: statusMap,
		characterType: avgDeviation >= 55 ? 'hero' : avgDeviation >= 45 ? 'normal' : 'ganbari',
		highestCategoryLevel,
	};
}

// ============================================================
// Achievements page data
// ============================================================

export function getDemoAchievementsData(childId: number): AchievementWithStatus[] {
	const childAch = getDemoAchievementsForChild(childId);
	const logs = getDemoLogsForChild(childId);
	const totalLogs = logs.length;

	return DEMO_ACHIEVEMENTS.map((a) => {
		const milestoneValues: number[] = a.milestoneValues ? JSON.parse(a.milestoneValues) : [];
		const unlockedEntries = childAch.filter((ca) => ca.achievementId === a.id);
		const isUnlocked = unlockedEntries.length > 0;

		let currentProgress = 0;
		if (a.conditionType === 'total_logs') currentProgress = totalLogs;
		else if (a.conditionType === 'streak_days') {
			const maxStreak = logs.reduce((max, l) => Math.max(max, l.streakDays), 0);
			currentProgress = maxStreak;
		} else if (a.conditionType === 'category_count') {
			const cats = new Set(
				logs
					.map((l) => DEMO_ACTIVITIES.find((act) => act.id === l.activityId)?.categoryId)
					.filter(Boolean),
			);
			currentProgress = cats.size;
		} else if (a.conditionType === 'level') {
			const status = getDemoStatusData(childId);
			currentProgress = status?.level ?? 0;
		}

		const milestones = milestoneValues.map((val) => ({
			value: val,
			unlocked: unlockedEntries.some((e) => e.milestoneValue === val),
			unlockedAt: unlockedEntries.find((e) => e.milestoneValue === val)?.unlockedAt ?? null,
		}));
		const unlockedMilestones = milestones.filter((m) => m.unlocked);
		const highestUnlockedMilestone =
			unlockedMilestones.length > 0 ? Math.max(...unlockedMilestones.map((m) => m.value)) : null;
		const nextMilestone =
			milestoneValues.find((v) => !milestones.find((m) => m.value === v && m.unlocked)) ?? null;

		return {
			id: a.id,
			code: a.code,
			name: a.name,
			description: a.description,
			icon: a.icon,
			category: a.category,
			conditionType: a.conditionType,
			conditionValue: a.conditionValue,
			bonusPoints: a.bonusPoints,
			rarity: a.rarity,
			sortOrder: a.sortOrder,
			repeatable: a.repeatable === 1,
			isMilestone: a.isMilestone === 1,
			milestones,
			highestUnlockedMilestone,
			nextMilestone,
			unlockedAt: isUnlocked && unlockedEntries[0] ? unlockedEntries[0].unlockedAt : null,
			currentProgress,
			conditionLabel: getConditionLabel(a.conditionType, a.conditionValue),
			liveStreak: a.conditionType === 'streak_days' ? currentProgress : null,
		};
	});
}

function getConditionLabel(type: string, value: number): string {
	switch (type) {
		case 'total_logs':
			return `${value}回きろくする`;
		case 'streak_days':
			return `${value}日れんぞく`;
		case 'category_count':
			return `${value}カテゴリでかつどう`;
		case 'level':
			return `レベル${value}に到達`;
		default:
			return `条件: ${value}`;
	}
}

// ============================================================
// Titles page data
// ============================================================

export function getDemoTitlesData(childId: number): TitleWithStatus[] {
	const childTitles = getDemoTitlesForChild(childId);
	const child = DEMO_CHILDREN.find((c) => c.id === childId);
	const status = getDemoStatusData(childId);

	return DEMO_TITLES.map((t) => {
		const unlock = childTitles.find((ct) => ct.titleId === t.id);
		const isActive = child?.activeTitleId === t.id;

		let progress = 0;
		if (t.conditionType === 'total_logs') {
			progress = getDemoLogsForChild(childId).length;
		} else if (t.conditionType === 'avg_status' && status) {
			const vals = Object.values(status.statuses) as StatusDetail[];
			const avg = vals.reduce((s, v) => s + v.deviationScore, 0) / 5;
			progress = avg;
		} else if (t.conditionType === 'level' && status) {
			progress = status.level;
		}

		return {
			id: t.id,
			code: t.code,
			name: t.name,
			description: t.description,
			icon: t.icon,
			conditionType: t.conditionType,
			conditionValue: t.conditionValue,
			rarity: t.rarity,
			sortOrder: t.sortOrder,
			unlockedAt: unlock?.unlockedAt ?? null,
			isActive,
			conditionLabel: getConditionLabel(t.conditionType, t.conditionValue),
			currentProgress: progress,
		};
	});
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
	const logs = getDemoLogsForChild(childId);
	return {
		logs: logs
			.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
			.map((l) => {
				const act = DEMO_ACTIVITIES.find((a) => a.id === l.activityId);
				const cat = CATEGORY_DEFS.find((c) => c.id === act?.categoryId);
				return {
					id: l.id,
					activityName: act?.name ?? '不明',
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
// Career page data (teen only)
// ============================================================

export function getDemoCareerData(childId: number) {
	if (childId !== 904) return { fields: DEMO_CAREER_FIELDS, plan: null };
	return {
		fields: DEMO_CAREER_FIELDS,
		plan: DEMO_CAREER_PLAN,
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
// Switch page data
// ============================================================

export function getDemoSwitchData() {
	return {
		children: DEMO_CHILDREN,
		adminLink: '/demo/admin',
	};
}
