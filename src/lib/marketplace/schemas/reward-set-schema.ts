/**
 * Marketplace `reward-set` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 * Issue #3151 slice2 (ADR-0066): 値域 literal の直書きを禁止し、domain 層の値域 SSOT 定数
 * (`$lib/domain/validation/special-reward.ts`) を参照する。domain Zod (grantSpecialRewardSchema)
 * と本 wire schema の値域一致 (domain⊆wire) は tests/unit/architecture/schema-range-ssot.test.ts
 * が boundary probe で機械表明する。
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `RewardSetPayload`
 */

import * as v from 'valibot';
import { SHOP_CATEGORIES } from '$lib/domain/shop-category.js';
import {
	isValidRewardIcon,
	REWARD_CATEGORIES,
	REWARD_DESCRIPTION_MAX,
	REWARD_POINTS_MAX,
	REWARD_POINTS_MIN,
	REWARD_TITLE_MAX,
	REWARD_TITLE_MIN,
} from '$lib/domain/validation/special-reward.js';

/** reward-set item: 単一のごほうび (`RewardSetPayload['rewards'][number]` の rebuild) */
export const RewardSetItemSchema = v.object({
	title: v.pipe(
		v.string('ごほうび名は文字列で指定してください'),
		v.minLength(REWARD_TITLE_MIN, 'ごほうび名は必須です'),
		v.maxLength(REWARD_TITLE_MAX, `ごほうび名は ${REWARD_TITLE_MAX} 文字以内で指定してください`),
	),
	points: v.pipe(
		v.number('points は数値で指定してください'),
		v.integer('points は整数で指定してください'),
		v.minValue(REWARD_POINTS_MIN, `points は ${REWARD_POINTS_MIN} 以上で指定してください`),
		v.maxValue(REWARD_POINTS_MAX, `points は ${REWARD_POINTS_MAX} 以下で指定してください`),
	),
	// icon は domain と同一 oracle (isValidRewardIcon、1〜2 grapheme) で判定 (#3151 slice2)。
	// 旧 maxLength(20) (UTF-16 units 基準) は domain 側 max(10) と非対称で、単一の絵文字という
	// 意図が表現方式ごとに二重定義されていた。isValidRewardIcon 共有で表現方式ごと統一。
	icon: v.pipe(
		v.string(),
		v.minLength(1, 'icon は必須です'),
		v.check(isValidRewardIcon, 'icon は 1〜2 個の絵文字で指定してください'),
	),
	category: v.picklist(
		REWARD_CATEGORIES,
		'category は REWARD_CATEGORIES のいずれかで指定してください',
	),
	description: v.optional(v.pipe(v.string(), v.maxLength(REWARD_DESCRIPTION_MAX))),
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
