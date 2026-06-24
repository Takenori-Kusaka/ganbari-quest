import { z } from 'zod';
import { SHOP_CATEGORIES } from '$lib/domain/shop-category';

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

// #3147: ショップ陳列系統 (physical/money/privilege)。RewardCategory(6値)とは直交する軸。
// SHOP_CATEGORIES は shop-category.ts の SSOT を再利用 (重複定義しない)。
export const shopCategorySchema = z.enum(SHOP_CATEGORIES);

export const grantSpecialRewardSchema = z.object({
	childId: z.coerce.number().int().positive(),
	title: z.string().min(1).max(100),
	description: z.string().max(500).optional(),
	points: z.number().int().positive().max(10000),
	icon: z.string().max(10).optional(),
	category: rewardCategorySchema,
	// #3147: 親が選ぶショップ陳列系統。省略時は表示側 deriveShopCategory に委ねる
	shopCategory: shopCategorySchema.optional(),
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
