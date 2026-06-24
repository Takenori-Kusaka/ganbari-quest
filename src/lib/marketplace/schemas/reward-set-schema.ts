/**
 * Marketplace `reward-set` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `RewardSetPayload`
 */

import * as v from 'valibot';
import { SHOP_CATEGORIES } from '$lib/domain/shop-category.js';
import { REWARD_CATEGORIES } from '$lib/domain/validation/special-reward.js';

/** reward-set item: 単一のごほうび (`RewardSetPayload['rewards'][number]` の rebuild) */
export const RewardSetItemSchema = v.object({
	title: v.pipe(
		v.string('ごほうび名は文字列で指定してください'),
		v.minLength(1, 'ごほうび名は必須です'),
		v.maxLength(100, 'ごほうび名は 100 文字以内で指定してください'),
	),
	points: v.pipe(
		v.number('points は数値で指定してください'),
		v.integer('points は整数で指定してください'),
		v.minValue(1, 'points は 1 以上で指定してください'),
		v.maxValue(10000, 'points は 10000 以下で指定してください'),
	),
	// icon は単一の emoji を想定 (ZWJ 連結 emoji 例: 👨‍👩‍👧‍👦 = 11 UTF-16 code units)
	// を許容するため maxLength=20 (ZWJ profession sequences は ~17 で安全圏)
	icon: v.pipe(v.string(), v.minLength(1, 'icon は必須です'), v.maxLength(20)),
	category: v.picklist(
		REWARD_CATEGORIES,
		'category は REWARD_CATEGORIES のいずれかで指定してください',
	),
	description: v.optional(v.pipe(v.string(), v.maxLength(500))),
	// #3147: ショップ陳列系統 (physical/money/privilege)。省略時は取込側で推定 fallback。
	// RewardCategory(6値) とは直交する軸 (登録カテゴリとショップ陳列の分離)。
	shopCategory: v.optional(
		v.picklist(SHOP_CATEGORIES, 'shopCategory は SHOP_CATEGORIES のいずれかで指定してください'),
	),
});

export const RewardSetPayloadSchema = v.object({
	rewards: v.pipe(
		v.array(RewardSetItemSchema),
		v.minLength(1, 'rewards は 1 件以上含めてください'),
	),
});

export type RewardSetItem = v.InferOutput<typeof RewardSetItemSchema>;
export type RewardSetPayload = v.InferOutput<typeof RewardSetPayloadSchema>;
