import { z } from 'zod';

// 実績条件タイプ
export const CONDITION_TYPES = [
	'streak_days',
	'total_activities',
	'category_complete',
	'all_categories',
	'level_reach',
	'total_points',
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

// レアリティ
export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

// Zod スキーマ
export const conditionTypeSchema = z.enum(CONDITION_TYPES);
export const raritySchema = z.enum(RARITIES);

export const achievementQuerySchema = z.object({
	childId: z.coerce.number().int().positive(),
});
