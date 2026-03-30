/**
 * Demo Mode — Static preset data for demo experience
 * All data is read-only. Write operations return success without persisting.
 *
 * Family: がんばり家
 * - Parent: がんばり太郎
 * - Child 1: ひかり (1歳, baby)  — Level 2
 * - Child 2: そうた (5歳, kinder) — Level 4
 * - Child 3: あおい (8歳, lower)  — Level 6
 * - Child 4: はると (15歳, teen)  — Level 8
 */

import type {
	Activity,
	ActivityLog,
	CareerField,
	CareerPlan,
	ChecklistTemplate,
	ChecklistTemplateItem,
	Child,
	ChildAchievement,
	ChildTitle,
	DailyMission,
	LoginBonus,
	Status,
} from '$lib/server/db/types/index.js';

// ============================================================
// Constants
// ============================================================

const DEMO_TENANT_ID = 'demo';
const NOW = '2026-03-27T09:00:00.000Z';
const TODAY = '2026-03-27';

function daysAgo(n: number): string {
	const d = new Date('2026-03-27');
	d.setDate(d.getDate() - n);
	return d.toISOString().slice(0, 10);
}

function daysAgoISO(n: number): string {
	const d = new Date('2026-03-27T09:00:00.000Z');
	d.setDate(d.getDate() - n);
	return d.toISOString();
}

// ============================================================
// Children
// ============================================================

export const DEMO_CHILDREN: Child[] = [
	{
		id: 901,
		nickname: 'ひかり',
		age: 1,
		birthDate: '2025-01-15',
		theme: 'pink',
		uiMode: 'baby',
		avatarUrl: null,
		activeTitleId: null,
		activeAvatarBg: null,
		activeAvatarFrame: null,
		activeAvatarEffect: null,
		displayConfig: null,
		userId: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	{
		id: 902,
		nickname: 'そうた',
		age: 5,
		birthDate: '2021-06-10',
		theme: 'green',
		uiMode: 'kinder',
		avatarUrl: null,
		activeTitleId: 1,
		activeAvatarBg: 1,
		activeAvatarFrame: null,
		activeAvatarEffect: null,
		displayConfig: null,
		userId: null,
		createdAt: '2025-09-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	{
		id: 903,
		nickname: 'あおい',
		age: 8,
		birthDate: '2018-03-22',
		theme: 'blue',
		uiMode: 'lower',
		avatarUrl: null,
		activeTitleId: 3,
		activeAvatarBg: 2,
		activeAvatarFrame: 1,
		activeAvatarEffect: null,
		displayConfig: null,
		userId: null,
		createdAt: '2025-04-01T00:00:00.000Z',
		updatedAt: NOW,
	},
	{
		id: 904,
		nickname: 'はると',
		age: 15,
		birthDate: '2011-08-05',
		theme: 'purple',
		uiMode: 'teen',
		avatarUrl: null,
		activeTitleId: 5,
		activeAvatarBg: 3,
		activeAvatarFrame: 2,
		activeAvatarEffect: 1,
		displayConfig: null,
		userId: null,
		createdAt: '2025-04-01T00:00:00.000Z',
		updatedAt: NOW,
	},
];

// ============================================================
// Activities (shared across all children)
// ============================================================

export const DEMO_ACTIVITIES: Activity[] = [
	// 運動 (categoryId: 1)
	{
		id: 1,
		name: 'さんぽ',
		categoryId: 1,
		icon: '🚶',
		basePoints: 10,
		ageMin: 0,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 1,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'さんぽ',
		nameKanji: '散歩',
		triggerHint: 'おそとを あるいて みよう！',
		createdAt: NOW,
	},
	{
		id: 2,
		name: 'たいそう',
		categoryId: 1,
		icon: '🤸',
		basePoints: 15,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 2,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'たいそう',
		nameKanji: '体操',
		triggerHint: 'からだを うごかして たいそう しよう！',
		createdAt: NOW,
	},
	{
		id: 3,
		name: 'スイミング',
		categoryId: 1,
		icon: '🏊',
		basePoints: 20,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 3,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'すいみんぐ',
		nameKanji: 'スイミング',
		triggerHint: 'プールで ばしゃばしゃ しよう！',
		createdAt: NOW,
	},
	{
		id: 4,
		name: 'サッカー',
		categoryId: 1,
		icon: '⚽',
		basePoints: 20,
		ageMin: 5,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 4,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'さっかー',
		nameKanji: 'サッカー',
		triggerHint: 'ボールを けって あそぼう！',
		createdAt: NOW,
	},

	// 勉強 (categoryId: 2)
	{
		id: 10,
		name: 'えほん',
		categoryId: 2,
		icon: '📖',
		basePoints: 10,
		ageMin: 0,
		ageMax: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 1,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'えほん',
		nameKanji: '絵本',
		triggerHint: 'えほんを よんで みよう！',
		createdAt: NOW,
	},
	{
		id: 11,
		name: 'しゅくだい',
		categoryId: 2,
		icon: '📝',
		basePoints: 15,
		ageMin: 6,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 2,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'しゅくだい',
		nameKanji: '宿題',
		triggerHint: 'きょうの しゅくだいを やろう！',
		createdAt: NOW,
	},
	{
		id: 12,
		name: 'どくしょ',
		categoryId: 2,
		icon: '📚',
		basePoints: 15,
		ageMin: 6,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 3,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'どくしょ',
		nameKanji: '読書',
		triggerHint: 'すきな ほんを よもう！',
		createdAt: NOW,
	},
	{
		id: 13,
		name: 'えいご',
		categoryId: 2,
		icon: '🔤',
		basePoints: 20,
		ageMin: 6,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 4,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'えいご',
		nameKanji: '英語',
		triggerHint: 'えいごの おべんきょう しよう！',
		createdAt: NOW,
	},

	// 生活 (categoryId: 3)
	{
		id: 20,
		name: 'はみがき',
		categoryId: 3,
		icon: '🪥',
		basePoints: 5,
		ageMin: 0,
		ageMax: null,
		isVisible: 1,
		dailyLimit: 0,
		sortOrder: 1,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'はみがき',
		nameKanji: '歯みがき',
		triggerHint: 'はを ぴかぴかに みがこう！',
		createdAt: NOW,
	},
	{
		id: 21,
		name: 'おかたづけ',
		categoryId: 3,
		icon: '🧹',
		basePoints: 10,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 2,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'おかたづけ',
		nameKanji: 'お片づけ',
		triggerHint: 'おもちゃを おかたづけ しよう！',
		createdAt: NOW,
	},
	{
		id: 22,
		name: 'おてつだい',
		categoryId: 3,
		icon: '🍳',
		basePoints: 15,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 3,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'おてつだい',
		nameKanji: 'お手伝い',
		triggerHint: 'おうちの おてつだい しよう！',
		createdAt: NOW,
	},
	{
		id: 23,
		name: 'せんたくもの',
		categoryId: 3,
		icon: '👕',
		basePoints: 10,
		ageMin: 6,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 4,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'せんたくもの',
		nameKanji: '洗濯物たたみ',
		triggerHint: 'せんたくものを たたもう！',
		createdAt: NOW,
	},

	// 交流 (categoryId: 4)
	{
		id: 30,
		name: 'あいさつ',
		categoryId: 4,
		icon: '👋',
		basePoints: 5,
		ageMin: 0,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 1,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'あいさつ',
		nameKanji: 'あいさつ',
		triggerHint: 'げんきに あいさつ しよう！',
		createdAt: NOW,
	},
	{
		id: 31,
		name: 'おともだちとあそぶ',
		categoryId: 4,
		icon: '🤝',
		basePoints: 15,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 2,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'おともだちとあそぶ',
		nameKanji: '友達と遊ぶ',
		triggerHint: 'おともだちと なかよく あそぼう！',
		createdAt: NOW,
	},
	{
		id: 32,
		name: 'かぞくのてつだい',
		categoryId: 4,
		icon: '👨‍👩‍👧',
		basePoints: 10,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 3,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'かぞくのてつだい',
		nameKanji: '家族のお手伝い',
		triggerHint: 'かぞくの おてつだい しよう！',
		createdAt: NOW,
	},

	// 創造 (categoryId: 5)
	{
		id: 40,
		name: 'おえかき',
		categoryId: 5,
		icon: '🎨',
		basePoints: 15,
		ageMin: 0,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 1,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'おえかき',
		nameKanji: 'お絵かき',
		triggerHint: 'すきなものを おえかき しよう！',
		createdAt: NOW,
	},
	{
		id: 41,
		name: 'こうさく',
		categoryId: 5,
		icon: '✂️',
		basePoints: 15,
		ageMin: 3,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 2,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'こうさく',
		nameKanji: '工作',
		triggerHint: 'はさみと のりで こうさく しよう！',
		createdAt: NOW,
	},
	{
		id: 42,
		name: 'ピアノ',
		categoryId: 5,
		icon: '🎹',
		basePoints: 20,
		ageMin: 5,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 3,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: 'ぴあの',
		nameKanji: 'ピアノ',
		triggerHint: 'すきな きょくを ひいてみよう！',
		createdAt: NOW,
	},
	{
		id: 43,
		name: 'プログラミング',
		categoryId: 5,
		icon: '💻',
		basePoints: 25,
		ageMin: 10,
		ageMax: null,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 4,
		source: 'seed',
		gradeLevel: null,
		subcategory: null,
		description: null,
		nameKana: null,
		nameKanji: 'プログラミング',
		triggerHint: 'コードを かいて うごかそう！',
		createdAt: NOW,
	},
];

// ============================================================
// Activity Logs (recent 14 days for each child)
// ============================================================

// Use fixed seed approach for deterministic data
export const DEMO_ACTIVITY_LOGS: ActivityLog[] = [
	// ひかり (baby) — simple logs
	...[0, 1, 2, 3, 5, 7, 10].flatMap((d, i) => [
		{
			id: 901001 + i * 2,
			childId: 901,
			activityId: 1,
			points: 11,
			streakDays: 3,
			streakBonus: 2,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 901002 + i * 2,
			childId: 901,
			activityId: 20,
			points: 6,
			streakDays: 3,
			streakBonus: 1,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
	]),
	// そうた (kinder) — moderate activity
	...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13].flatMap((d, i) => [
		{
			id: 902001 + i * 3,
			childId: 902,
			activityId: 2,
			points: 17,
			streakDays: 10,
			streakBonus: 5,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 902002 + i * 3,
			childId: 902,
			activityId: 10,
			points: 12,
			streakDays: 10,
			streakBonus: 3,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		...(d % 2 === 0
			? [
					{
						id: 902003 + i * 3,
						childId: 902,
						activityId: 21,
						points: 12,
						streakDays: 5,
						streakBonus: 2,
						recordedDate: daysAgo(d),
						recordedAt: daysAgoISO(d),
						cancelled: 0,
					},
				]
			: []),
	]),
	// あおい (lower) — active with variety
	...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].flatMap((d, i) => [
		{
			id: 903001 + i * 4,
			childId: 903,
			activityId: 11,
			points: 18,
			streakDays: 14,
			streakBonus: 7,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 903002 + i * 4,
			childId: 903,
			activityId: 4,
			points: 23,
			streakDays: 14,
			streakBonus: 7,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 903003 + i * 4,
			childId: 903,
			activityId: 22,
			points: 17,
			streakDays: 14,
			streakBonus: 5,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		...(d % 3 === 0
			? [
					{
						id: 903004 + i * 4,
						childId: 903,
						activityId: 40,
						points: 18,
						streakDays: 5,
						streakBonus: 3,
						recordedDate: daysAgo(d),
						recordedAt: daysAgoISO(d),
						cancelled: 0,
					},
				]
			: []),
	]),
	// はると (teen) — very active, all categories
	...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].flatMap((d, i) => [
		{
			id: 904001 + i * 5,
			childId: 904,
			activityId: 4,
			points: 25,
			streakDays: 14,
			streakBonus: 10,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 904002 + i * 5,
			childId: 904,
			activityId: 11,
			points: 20,
			streakDays: 14,
			streakBonus: 10,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 904003 + i * 5,
			childId: 904,
			activityId: 13,
			points: 25,
			streakDays: 14,
			streakBonus: 10,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 904004 + i * 5,
			childId: 904,
			activityId: 22,
			points: 20,
			streakDays: 14,
			streakBonus: 8,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
		{
			id: 904005 + i * 5,
			childId: 904,
			activityId: 43,
			points: 30,
			streakDays: 14,
			streakBonus: 10,
			recordedDate: daysAgo(d),
			recordedAt: daysAgoISO(d),
			cancelled: 0,
		},
	]),
];

// ============================================================
// Status (5-axis per child)
// ============================================================

export const DEMO_STATUSES: Status[] = [
	// ひかり (baby, level 2) — low values
	{ id: 9011, childId: 901, categoryId: 1, value: 15, updatedAt: NOW },
	{ id: 9012, childId: 901, categoryId: 2, value: 8, updatedAt: NOW },
	{ id: 9013, childId: 901, categoryId: 3, value: 20, updatedAt: NOW },
	{ id: 9014, childId: 901, categoryId: 4, value: 10, updatedAt: NOW },
	{ id: 9015, childId: 901, categoryId: 5, value: 12, updatedAt: NOW },
	// そうた (kinder, level 4) — moderate
	{ id: 9021, childId: 902, categoryId: 1, value: 80, updatedAt: NOW },
	{ id: 9022, childId: 902, categoryId: 2, value: 65, updatedAt: NOW },
	{ id: 9023, childId: 902, categoryId: 3, value: 55, updatedAt: NOW },
	{ id: 9024, childId: 902, categoryId: 4, value: 45, updatedAt: NOW },
	{ id: 9025, childId: 902, categoryId: 5, value: 70, updatedAt: NOW },
	// あおい (lower, level 6) — active
	{ id: 9031, childId: 903, categoryId: 1, value: 250, updatedAt: NOW },
	{ id: 9032, childId: 903, categoryId: 2, value: 200, updatedAt: NOW },
	{ id: 9033, childId: 903, categoryId: 3, value: 180, updatedAt: NOW },
	{ id: 9034, childId: 903, categoryId: 4, value: 120, updatedAt: NOW },
	{ id: 9035, childId: 903, categoryId: 5, value: 160, updatedAt: NOW },
	// はると (teen, level 8) — very active
	{ id: 9041, childId: 904, categoryId: 1, value: 1200, updatedAt: NOW },
	{ id: 9042, childId: 904, categoryId: 2, value: 1500, updatedAt: NOW },
	{ id: 9043, childId: 904, categoryId: 3, value: 800, updatedAt: NOW },
	{ id: 9044, childId: 904, categoryId: 4, value: 600, updatedAt: NOW },
	{ id: 9045, childId: 904, categoryId: 5, value: 1100, updatedAt: NOW },
];

// ============================================================
// Point Balances (computed from logs)
// ============================================================

export const DEMO_POINT_BALANCES: Record<number, number> = {
	901: 180, // baby — low
	902: 1250, // kinder — moderate
	903: 3400, // lower — active
	904: 8500, // teen — very active
};

// ============================================================
// Achievements & Titles
// ============================================================

export const DEMO_CHILD_ACHIEVEMENTS: ChildAchievement[] = [
	// そうた
	{ id: 1, childId: 902, achievementId: 1, milestoneValue: null, unlockedAt: daysAgoISO(20) },
	{ id: 2, childId: 902, achievementId: 2, milestoneValue: 10, unlockedAt: daysAgoISO(15) },
	// あおい
	{ id: 3, childId: 903, achievementId: 1, milestoneValue: null, unlockedAt: daysAgoISO(60) },
	{ id: 4, childId: 903, achievementId: 2, milestoneValue: 10, unlockedAt: daysAgoISO(50) },
	{ id: 5, childId: 903, achievementId: 2, milestoneValue: 50, unlockedAt: daysAgoISO(30) },
	{ id: 6, childId: 903, achievementId: 3, milestoneValue: null, unlockedAt: daysAgoISO(25) },
	{ id: 7, childId: 903, achievementId: 4, milestoneValue: null, unlockedAt: daysAgoISO(10) },
	// はると
	{ id: 8, childId: 904, achievementId: 1, milestoneValue: null, unlockedAt: daysAgoISO(90) },
	{ id: 9, childId: 904, achievementId: 2, milestoneValue: 10, unlockedAt: daysAgoISO(80) },
	{ id: 10, childId: 904, achievementId: 2, milestoneValue: 50, unlockedAt: daysAgoISO(60) },
	{ id: 11, childId: 904, achievementId: 2, milestoneValue: 100, unlockedAt: daysAgoISO(30) },
	{ id: 12, childId: 904, achievementId: 3, milestoneValue: null, unlockedAt: daysAgoISO(70) },
	{ id: 13, childId: 904, achievementId: 4, milestoneValue: null, unlockedAt: daysAgoISO(50) },
	{ id: 14, childId: 904, achievementId: 5, milestoneValue: null, unlockedAt: daysAgoISO(20) },
];

export const DEMO_CHILD_TITLES: ChildTitle[] = [
	{ id: 1, childId: 902, titleId: 1, unlockedAt: daysAgoISO(20) },
	{ id: 2, childId: 903, titleId: 1, unlockedAt: daysAgoISO(60) },
	{ id: 3, childId: 903, titleId: 3, unlockedAt: daysAgoISO(25) },
	{ id: 4, childId: 904, titleId: 1, unlockedAt: daysAgoISO(90) },
	{ id: 5, childId: 904, titleId: 3, unlockedAt: daysAgoISO(70) },
	{ id: 6, childId: 904, titleId: 5, unlockedAt: daysAgoISO(20) },
];

// ============================================================
// Daily Missions (today)
// ============================================================

export const DEMO_DAILY_MISSIONS: DailyMission[] = [
	// そうた — 3 missions, 1 done
	{ id: 1, childId: 902, missionDate: TODAY, activityId: 2, completed: 1, completedAt: NOW },
	{ id: 2, childId: 902, missionDate: TODAY, activityId: 10, completed: 0, completedAt: null },
	{ id: 3, childId: 902, missionDate: TODAY, activityId: 30, completed: 0, completedAt: null },
	// あおい — 3 missions, 2 done
	{ id: 4, childId: 903, missionDate: TODAY, activityId: 11, completed: 1, completedAt: NOW },
	{ id: 5, childId: 903, missionDate: TODAY, activityId: 4, completed: 1, completedAt: NOW },
	{ id: 6, childId: 903, missionDate: TODAY, activityId: 40, completed: 0, completedAt: null },
	// はると — 3 missions, all done
	{ id: 7, childId: 904, missionDate: TODAY, activityId: 4, completed: 1, completedAt: NOW },
	{ id: 8, childId: 904, missionDate: TODAY, activityId: 13, completed: 1, completedAt: NOW },
	{ id: 9, childId: 904, missionDate: TODAY, activityId: 43, completed: 1, completedAt: NOW },
];

// ============================================================
// Checklist Templates
// ============================================================

export const DEMO_CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
	{
		id: 901,
		childId: 902,
		name: 'あさのしたく',
		icon: '🌅',
		pointsPerItem: 2,
		completionBonus: 5,
		isActive: 1,
		createdAt: NOW,
		updatedAt: NOW,
	},
	{
		id: 902,
		childId: 903,
		name: '帰ったらやること',
		icon: '🏠',
		pointsPerItem: 3,
		completionBonus: 10,
		isActive: 1,
		createdAt: NOW,
		updatedAt: NOW,
	},
];

export const DEMO_CHECKLIST_ITEMS: ChecklistTemplateItem[] = [
	{
		id: 1,
		templateId: 901,
		name: 'かおをあらう',
		icon: '💧',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 1,
		createdAt: NOW,
	},
	{
		id: 2,
		templateId: 901,
		name: 'はみがき',
		icon: '🪥',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 2,
		createdAt: NOW,
	},
	{
		id: 3,
		templateId: 901,
		name: 'おきがえ',
		icon: '👕',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 3,
		createdAt: NOW,
	},
	{
		id: 4,
		templateId: 901,
		name: 'あさごはん',
		icon: '🍚',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 4,
		createdAt: NOW,
	},
	{
		id: 5,
		templateId: 902,
		name: '手洗い・うがい',
		icon: '🫧',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 1,
		createdAt: NOW,
	},
	{
		id: 6,
		templateId: 902,
		name: '宿題',
		icon: '📝',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 2,
		createdAt: NOW,
	},
	{
		id: 7,
		templateId: 902,
		name: '明日の準備',
		icon: '🎒',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 3,
		createdAt: NOW,
	},
	{
		id: 8,
		templateId: 902,
		name: 'お風呂',
		icon: '🛁',
		frequency: 'daily',
		direction: 'positive',
		sortOrder: 4,
		createdAt: NOW,
	},
];

// ============================================================
// Login Bonus
// ============================================================

export const DEMO_LOGIN_BONUSES: LoginBonus[] = [
	{
		id: 1,
		childId: 902,
		loginDate: TODAY,
		rank: 'dai-kichi',
		basePoints: 10,
		multiplier: 1.5,
		totalPoints: 15,
		consecutiveDays: 5,
		createdAt: NOW,
	},
	{
		id: 2,
		childId: 903,
		loginDate: TODAY,
		rank: 'kichi',
		basePoints: 5,
		multiplier: 2.0,
		totalPoints: 10,
		consecutiveDays: 14,
		createdAt: NOW,
	},
	{
		id: 3,
		childId: 904,
		loginDate: TODAY,
		rank: 'chu-kichi',
		basePoints: 3,
		multiplier: 2.0,
		totalPoints: 6,
		consecutiveDays: 14,
		createdAt: NOW,
	},
];

// ============================================================
// Career Plan (teen only)
// ============================================================

export const DEMO_CAREER_FIELDS: CareerField[] = [
	{
		id: 1,
		name: 'エンジニア・プログラマー',
		description: 'ソフトウェア開発やシステム構築',
		icon: '💻',
		relatedCategories: '[2,5]',
		recommendedActivities: '[43,13]',
		minAge: 10,
		createdAt: NOW,
	},
	{
		id: 2,
		name: 'スポーツ選手',
		description: 'プロスポーツや競技',
		icon: '⚽',
		relatedCategories: '[1]',
		recommendedActivities: '[3,4]',
		minAge: 8,
		createdAt: NOW,
	},
	{
		id: 3,
		name: '医師・看護師',
		description: '医療・ヘルスケア',
		icon: '🏥',
		relatedCategories: '[2,4]',
		recommendedActivities: '[11,12]',
		minAge: 10,
		createdAt: NOW,
	},
];

export const DEMO_CAREER_PLAN: CareerPlan = {
	id: 1,
	childId: 904,
	careerFieldId: 1,
	dreamText: 'ゲームを作るプログラマーになりたい',
	mandalaChart: JSON.stringify({
		center: 'ゲームプログラマー',
		surrounding: [
			{
				goal: 'プログラミングスキル',
				actions: [
					'毎日1時間コーディング',
					'Pythonを学ぶ',
					'ゲームを1本完成させる',
					'競プロに挑戦',
					'',
					'',
					'',
					'',
				],
			},
			{
				goal: '数学力',
				actions: ['数学の成績5を目指す', '確率・統計を学ぶ', '', '', '', '', '', ''],
			},
			{
				goal: '英語力',
				actions: ['技術ドキュメントを読む', '英語の授業で発表', '', '', '', '', '', ''],
			},
			{
				goal: 'チームワーク',
				actions: ['部活で協力する', 'ハッカソンに参加', '', '', '', '', '', ''],
			},
			{ goal: '体力づくり', actions: ['毎日30分運動', 'サッカーを続ける', '', '', '', '', '', ''] },
			{ goal: '創造力', actions: ['デザインを学ぶ', 'UIを考える', '', '', '', '', '', ''] },
			{
				goal: '知識を広げる',
				actions: ['本を月2冊読む', 'ニュースを見る', '', '', '', '', '', ''],
			},
			{ goal: '生活習慣', actions: ['早寝早起き', '計画的に行動する', '', '', '', '', '', ''] },
		],
	}),
	timeline3y: '高校でプログラミング部に入り、基礎を固める',
	timeline5y: '大学で情報工学を学び、インターンに参加する',
	timeline10y: 'ゲーム会社でプログラマーとして活躍する',
	targetStatuses: JSON.stringify([
		{ categoryId: 2, target: 2000 },
		{ categoryId: 5, target: 1800 },
	]),
	version: 1,
	isActive: 1,
	createdAt: daysAgoISO(30),
	updatedAt: NOW,
};

// ============================================================
// Helper: Get demo data for a specific child
// ============================================================

export function getDemoChild(childId: number): Child | undefined {
	return DEMO_CHILDREN.find((c) => c.id === childId);
}

export function getDemoActivitiesForChild(childAge: number): Activity[] {
	return DEMO_ACTIVITIES.filter(
		(a) =>
			(a.ageMin === null || childAge >= a.ageMin) && (a.ageMax === null || childAge <= a.ageMax),
	);
}

export function getDemoLogsForChild(childId: number): ActivityLog[] {
	return DEMO_ACTIVITY_LOGS.filter((l) => l.childId === childId);
}

export function getDemoStatusesForChild(childId: number): Status[] {
	return DEMO_STATUSES.filter((s) => s.childId === childId);
}

export function getDemoMissionsForChild(childId: number): DailyMission[] {
	return DEMO_DAILY_MISSIONS.filter((m) => m.childId === childId);
}

export function getDemoChecklistsForChild(childId: number): {
	templates: ChecklistTemplate[];
	items: ChecklistTemplateItem[];
} {
	const templates = DEMO_CHECKLIST_TEMPLATES.filter((t) => t.childId === childId);
	const templateIds = templates.map((t) => t.id);
	const items = DEMO_CHECKLIST_ITEMS.filter((i) => templateIds.includes(i.templateId));
	return { templates, items };
}

export function getDemoPointBalance(childId: number): number {
	return DEMO_POINT_BALANCES[childId] ?? 0;
}

export function getDemoAchievementsForChild(childId: number): ChildAchievement[] {
	return DEMO_CHILD_ACHIEVEMENTS.filter((a) => a.childId === childId);
}

export function getDemoTitlesForChild(childId: number): ChildTitle[] {
	return DEMO_CHILD_TITLES.filter((t) => t.childId === childId);
}

export { DEMO_TENANT_ID, TODAY, NOW };
