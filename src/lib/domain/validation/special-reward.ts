import { z } from 'zod';

// 特別報酬カテゴリ
export const REWARD_CATEGORIES = [
	'academic',
	'sports',
	'social',
	'creative',
	'life',
	'other',
] as const;
export type RewardCategory = (typeof REWARD_CATEGORIES)[number];

// Zod スキーマ
export const rewardCategorySchema = z.enum(REWARD_CATEGORIES);

export const grantSpecialRewardSchema = z.object({
	childId: z.coerce.number().int().positive(),
	title: z.string().min(1).max(100),
	description: z.string().max(500).optional(),
	points: z.number().int().positive().max(10000),
	icon: z.string().max(10).optional(),
	category: rewardCategorySchema,
});

export const specialRewardQuerySchema = z.object({
	childId: z.coerce.number().int().positive(),
});

export const rewardTemplateSchema = z.object({
	title: z.string().min(1).max(100),
	points: z.number().int().positive().max(10000),
	icon: z.string().max(10).optional(),
	category: rewardCategorySchema,
});

export const rewardTemplatesArraySchema = z.array(rewardTemplateSchema);
