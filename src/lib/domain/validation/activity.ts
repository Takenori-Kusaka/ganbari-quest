import { z } from 'zod';

export const CATEGORIES = ['うんどう', 'べんきょう', 'せいかつ', 'こうりゅう', 'そうぞう'] as const;

export type Category = (typeof CATEGORIES)[number];

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
	category: z.enum(CATEGORIES),
	icon: z.string().min(1).refine(
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
	category: z.enum(CATEGORIES).optional(),
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

/** Calculate streak bonus: min(consecutiveDays - 1, 10) */
export function calcStreakBonus(consecutiveDays: number): number {
	if (consecutiveDays < 2) return 0;
	return Math.min(consecutiveDays - 1, 10);
}

/** Get today's date in YYYY-MM-DD format (JST) */
export { todayDateJST as todayDate } from '$lib/domain/date-utils';

/** Cancel window in milliseconds (5 seconds) */
export const CANCEL_WINDOW_MS = 5000;
