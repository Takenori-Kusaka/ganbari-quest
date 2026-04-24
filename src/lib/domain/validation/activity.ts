import { z } from 'zod';

export const CATEGORIES = ['うんどう', 'べんきょう', 'せいかつ', 'こうりゅう', 'そうぞう'] as const;

export type Category = (typeof CATEGORIES)[number];

// ============================================================
// カテゴリマスタ定義（サロゲートキー）
// ============================================================
export const CATEGORY_CODES = ['undou', 'benkyou', 'seikatsu', 'kouryuu', 'souzou'] as const;
export type CategoryCode = (typeof CATEGORY_CODES)[number];

export interface CategoryDef {
	readonly id: number;
	readonly code: CategoryCode;
	readonly name: Category;
	readonly icon: string;
	readonly color: string;
	readonly accent: string;
}

export const CATEGORY_DEFS: readonly CategoryDef[] = [
	{ id: 1, code: 'undou', name: 'うんどう', icon: '🏃', color: '#FF6B6B', accent: '#D32F2F' },
	{ id: 2, code: 'benkyou', name: 'べんきょう', icon: '📚', color: '#4ECDC4', accent: '#00897B' },
	{ id: 3, code: 'seikatsu', name: 'せいかつ', icon: '🏠', color: '#FFE66D', accent: '#F9A825' },
	{ id: 4, code: 'kouryuu', name: 'こうりゅう', icon: '🤝', color: '#A8E6CF', accent: '#2E7D32' },
	{ id: 5, code: 'souzou', name: 'そうぞう', icon: '🎨', color: '#DDA0DD', accent: '#7B1FA2' },
] as const;

export const CATEGORY_IDS = CATEGORY_DEFS.map((c) => c.id) as [number, ...number[]];

export function getCategoryById(id: number): CategoryDef | undefined {
	return CATEGORY_DEFS.find((c) => c.id === id);
}

export function getCategoryByCode(code: string): CategoryDef | undefined {
	return CATEGORY_DEFS.find((c) => c.code === code);
}

export function getCategoryByName(name: string): CategoryDef | undefined {
	return CATEGORY_DEFS.find((c) => c.name === name);
}

export const GRADE_LEVELS = [
	'baby',
	'kinder',
	'elementary_lower',
	'elementary_upper',
	'middle_school',
	'high_school',
] as const;

export type GradeLevel = (typeof GRADE_LEVELS)[number];

export const SOURCES = ['seed', 'curriculum', 'custom', 'parent'] as const;

export type Source = (typeof SOURCES)[number];

export const createActivitySchema = z.object({
	name: z.string().min(1).max(50),
	categoryId: z.number().int().min(1).max(5),
	icon: z
		.string()
		.min(1)
		.refine(
			(val) => {
				const seg = new Intl.Segmenter('ja', { granularity: 'grapheme' });
				const count = [...seg.segment(val)].length;
				return count >= 1 && count <= 2;
			},
			{ message: 'アイコンは1〜2つの絵文字で指定してください' },
		),
	basePoints: z.number().int().min(1).max(100),
	ageMin: z.number().int().min(0).max(20).nullable(),
	ageMax: z.number().int().min(0).max(20).nullable(),
	source: z.enum(SOURCES).optional(),
	gradeLevel: z.enum(GRADE_LEVELS).nullable().optional(),
	subcategory: z.string().max(50).nullable().optional(),
	description: z.string().max(200).nullable().optional(),
	dailyLimit: z.number().int().min(0).max(99).nullable().optional(),
	nameKana: z.string().max(50).nullable().optional(),
	nameKanji: z.string().max(50).nullable().optional(),
	triggerHint: z.string().max(30).nullable().optional(),
});

export const updateActivitySchema = createActivitySchema.partial();

export const recordActivitySchema = z.object({
	childId: z.number().int().positive(),
	activityId: z.number().int().positive(),
});

export const activityLogsQuerySchema = z.object({
	childId: z.coerce.number().int().positive(),
	period: z.enum(['week', 'month', 'year']).default('week'),
	from: z.string().optional(),
	to: z.string().optional(),
});

export const activitiesQuerySchema = z.object({
	childId: z.coerce.number().int().positive().optional(),
	categoryId: z.coerce.number().int().min(1).max(5).optional(),
	includeHidden: z
		.string()
		.transform((v) => v === 'true')
		.optional(),
});

/** 漢字表記に切り替える年齢閾値（小学1年生以上） */
export const KANJI_AGE_THRESHOLD = 6;

/** 子供の年齢に応じた活動の表示名を返す */
export function getActivityDisplayName(
	activity: { name: string; nameKana?: string | null; nameKanji?: string | null },
	childAge: number,
): string {
	if (childAge >= KANJI_AGE_THRESHOLD && activity.nameKanji) {
		return activity.nameKanji;
	}
	if (childAge < KANJI_AGE_THRESHOLD && activity.nameKana) {
		return activity.nameKana;
	}
	return activity.name;
}

/** 親（大人）向けの表示名: 漢字表記を優先 */
export function getActivityDisplayNameForAdult(activity: {
	name: string;
	nameKanji?: string | null;
}): string {
	return activity.nameKanji || activity.name;
}

/** Calculate streak bonus: min(consecutiveDays - 1, 10) */
export function calcStreakBonus(consecutiveDays: number): number {
	if (consecutiveDays < 2) return 0;
	return Math.min(consecutiveDays - 1, 10);
}

/** Get today's date in YYYY-MM-DD format (JST) */
// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { todayDateJST as todayDate } from '$lib/domain/date-utils';

/** Cancel window in milliseconds (5 seconds) */
export const CANCEL_WINDOW_MS = 5000;

// ============================================================
// 活動習熟レベル (Activity Mastery)
// ============================================================

/** 累積回数 → レベル対応テーブル（対数的成長） */
export const MASTERY_LEVEL_TABLE: ReadonlyArray<{ minCount: number; level: number }> = [
	{ minCount: 0, level: 1 },
	{ minCount: 5, level: 2 },
	{ minCount: 10, level: 3 },
	{ minCount: 20, level: 4 },
	{ minCount: 30, level: 5 },
	{ minCount: 50, level: 6 },
	{ minCount: 70, level: 7 },
	{ minCount: 100, level: 8 },
	{ minCount: 130, level: 9 },
	{ minCount: 170, level: 10 },
	{ minCount: 220, level: 11 },
	{ minCount: 280, level: 12 },
	{ minCount: 350, level: 13 },
	{ minCount: 430, level: 14 },
	{ minCount: 520, level: 15 },
	{ minCount: 620, level: 16 },
	{ minCount: 730, level: 17 },
	{ minCount: 850, level: 18 },
	{ minCount: 980, level: 19 },
	{ minCount: 1120, level: 20 },
	{ minCount: 1280, level: 21 },
	{ minCount: 1450, level: 22 },
	{ minCount: 1640, level: 23 },
	{ minCount: 1850, level: 24 },
	{ minCount: 2080, level: 25 },
	{ minCount: 2330, level: 26 },
	{ minCount: 2600, level: 27 },
	{ minCount: 2900, level: 28 },
	{ minCount: 3220, level: 29 },
	{ minCount: 3570, level: 30 },
	{ minCount: 3950, level: 31 },
	{ minCount: 4360, level: 32 },
	{ minCount: 4800, level: 33 },
	{ minCount: 5270, level: 34 },
	{ minCount: 5770, level: 35 },
	{ minCount: 6300, level: 36 },
	{ minCount: 6860, level: 37 },
	{ minCount: 7450, level: 38 },
	{ minCount: 8070, level: 39 },
	{ minCount: 8720, level: 40 },
	{ minCount: 9999, level: 99 },
];

/** 累積回数からレベルを算出 */
export function calcMasteryLevel(totalCount: number): number {
	const entry = [...MASTERY_LEVEL_TABLE].reverse().find((e) => totalCount >= e.minCount);
	return Math.min(entry?.level ?? 1, 99);
}

/** 次のレベルまでの必要回数（残り） */
export function countToNextMasteryLevel(totalCount: number): number {
	const currentLevel = calcMasteryLevel(totalCount);
	const nextEntry = MASTERY_LEVEL_TABLE.find((e) => e.level === currentLevel + 1);
	if (!nextEntry) return 0; // Lv99 (cap)
	return nextEntry.minCount - totalCount;
}

/** レベルに応じたポイントボーナス: floor(level / 5) */
export function calcMasteryBonus(level: number): number {
	return Math.floor(level / 5);
}

/** 節目レベル（派手な演出対象） */
export const MASTERY_MILESTONE_LEVELS = new Set([5, 10, 20, 30, 50, 99]);
