import { z } from 'zod';
import { SHOP_CATEGORIES } from '$lib/domain/shop-category';
// #3151 slice2 (ADR-0066): icon の値域は「grapheme 数」で判定する。grapheme 計数は activity と
// 同一実装 (countIconGraphemes) を共有し、値でなく述語を SSOT 化する (ADR-0066 原則 2)。
import { countIconGraphemes } from './activity';
import { childIdSchema } from './id-schema';

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

// ============================================================
// ごほうび 値域 SSOT (#3151 slice2 / ADR-0066)
// ============================================================
// domain Zod schema (本ファイル grantSpecialRewardSchema / rewardTemplateSchema) と wire
// Valibot schema (src/lib/marketplace/schemas/reward-set-schema.ts) の両方が本定数を参照する。
// 値域 literal の二重定義は #3132 (reward points 値域ドリフト blocker) の root class のため禁止。
// domain⊆wire 包含は tests/unit/architecture/schema-range-ssot.test.ts が boundary probe で機械表明する。

export const REWARD_TITLE_MIN = 1;
export const REWARD_TITLE_MAX = 100;
export const REWARD_POINTS_MIN = 1;
/** ポイント経済設計の上限。#3132 で domain / wire を本値に統一 (往復破綻の再発防止) */
export const REWARD_POINTS_MAX = 10000;
export const REWARD_DESCRIPTION_MAX = 500;
export const REWARD_ICON_MIN_GRAPHEMES = 1;
export const REWARD_ICON_MAX_GRAPHEMES = 2;

/**
 * ごほうび icon 値域 (1〜2 grapheme) 判定。domain Zod refine と wire Valibot check の共有 oracle (#3151)。
 * 旧 domain 側 `max(10)` (UTF-16 units 基準) は ZWJ 連結絵文字 1 個 (👨‍👩‍👧‍👦 = 11 units) を弾き、
 * wire 側 `maxLength(20)` はそれを受理していたため両者が非対称だった。grapheme 判定への統一で
 * 「単一の絵文字」という意図を表現方式ごと SSOT 化し、domain / wire を同一境界に揃える。
 */
export function isValidRewardIcon(val: string): boolean {
	const count = countIconGraphemes(val);
	return count >= REWARD_ICON_MIN_GRAPHEMES && count <= REWARD_ICON_MAX_GRAPHEMES;
}

export const grantSpecialRewardSchema = z.object({
	childId: childIdSchema,
	title: z.string().min(REWARD_TITLE_MIN).max(REWARD_TITLE_MAX),
	description: z.string().max(REWARD_DESCRIPTION_MAX).optional(),
	points: z.number().int().min(REWARD_POINTS_MIN).max(REWARD_POINTS_MAX),
	icon: z
		.string()
		.min(1)
		.refine(isValidRewardIcon, { message: 'アイコンは1〜2つの絵文字で指定してください' })
		.optional(),
	category: rewardCategorySchema,
	// #3147: 親が選ぶショップ陳列系統。省略時は表示側 deriveShopCategory に委ねる
	shopCategory: shopCategorySchema.optional(),
});

export const specialRewardQuerySchema = z.object({
	childId: childIdSchema,
});

export const rewardTemplateSchema = z.object({
	title: z.string().min(REWARD_TITLE_MIN).max(REWARD_TITLE_MAX),
	points: z.number().int().min(REWARD_POINTS_MIN).max(REWARD_POINTS_MAX),
	icon: z
		.string()
		.min(1)
		.refine(isValidRewardIcon, { message: 'アイコンは1〜2つの絵文字で指定してください' })
		.optional(),
	category: rewardCategorySchema,
});

export const rewardTemplatesArraySchema = z.array(rewardTemplateSchema);
