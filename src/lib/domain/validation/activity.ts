import { z } from 'zod';

export const CATEGORIES = [
	'うんどう',
	'べんきょう',
	'せいかつ',
	'こうりゅう',
	'そうぞう',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const createActivitySchema = z.object({
	name: z.string().min(1).max(50),
	category: z.enum(CATEGORIES),
	icon: z.string().min(1),
	basePoints: z.number().int().min(1).max(100),
	ageMin: z.number().int().min(0).max(20).nullable(),
	ageMax: z.number().int().min(0).max(20).nullable(),
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

/** Calculate streak bonus: min(consecutiveDays - 1, 10) */
export function calcStreakBonus(consecutiveDays: number): number {
	if (consecutiveDays < 2) return 0;
	return Math.min(consecutiveDays - 1, 10);
}

/** Get today's date in YYYY-MM-DD format */
export function todayDate(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Cancel window in milliseconds (5 seconds) */
export const CANCEL_WINDOW_MS = 5000;
