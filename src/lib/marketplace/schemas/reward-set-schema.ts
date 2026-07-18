/**
 * Marketplace `reward-set` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 * Issue #3151 slice2 (ADR-0066): 値域 literal の直書きを禁止し、domain 層の値域 SSOT 定数を参照する。
 * Issue #3852 Phase B-0 (EPIC #3151 選択肢 B): 値域「定数」だけでなく field「schema 構造」も domain 層
 * (`$lib/domain/validation/special-reward.ts`) の field pipe を import して組み立てる。これにより
 * 旧来 domain / wire で 2 回宣言していた title/points/icon/category/description の shape が単一定義になり、
 * domain⊆wire は tests/unit/architecture/schema-range-ssot.test.ts の boundary probe で機械表明される。
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `RewardSetPayload`
 */

import * as v from 'valibot';
import {
	rewardCategorySchema,
	rewardDescriptionSchema,
	rewardIconSchema,
	rewardPointsSchema,
	rewardTitleSchema,
	shopCategorySchema,
} from '$lib/domain/validation/special-reward.js';

/**
 * reward-set item: 単一のごほうび (`RewardSetPayload['rewards'][number]` の rebuild)。
 * title/points/icon/category/description は domain 層 field schema (special-reward.ts) の再利用。
 * wire では icon を必須 (rewardIconSchema をそのまま) にする — export 経路は DB の null icon を
 * '🎁' へ既定化してから wire schema に渡すため、往復時 icon は常に present (domain 側 optional との差)。
 */
export const RewardSetItemSchema = v.object({
	title: rewardTitleSchema,
	points: rewardPointsSchema,
	icon: rewardIconSchema,
	category: rewardCategorySchema,
	description: v.optional(rewardDescriptionSchema),
	// #3147: ショップ陳列系統 (physical/money/privilege)。省略時は取込側で推定 fallback。
	// RewardCategory(6値) とは直交する軸 (登録カテゴリとショップ陳列の分離)。
	shopCategory: v.optional(shopCategorySchema),
});

export const RewardSetPayloadSchema = v.object({
	rewards: v.pipe(
		v.array(RewardSetItemSchema),
		v.minLength(1, 'rewards は 1 件以上含めてください'),
	),
});

export type RewardSetItem = v.InferOutput<typeof RewardSetItemSchema>;
export type RewardSetPayload = v.InferOutput<typeof RewardSetPayloadSchema>;
