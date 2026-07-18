// #3151 slice2 / #3852 Phase B-0 (EPIC #3151 選択肢 B、ADR-0066):
// 特別報酬 (special-reward) の値域 SSOT + validation schema。
// domain / wire の「値域定数」二重定義は slice2 で禁止済 (下記 REWARD_* 定数)。本 Phase B-0 では
// さらに「schema 構造」の二重定義 (旧: domain Zod object と wire Valibot object が同じ field shape を
// 別ライブラリで 2 回宣言していた) を単一 Valibot 定義へ統合する。field 単位の Valibot pipe を本ファイルに
// SSOT 化し、wire schema (src/lib/marketplace/schemas/reward-set-schema.ts) はそれを import して組み立てる。
// domain⊆wire 包含は tests/unit/architecture/schema-range-ssot.test.ts が boundary probe で機械表明する。

import * as v from 'valibot';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { SHOP_CATEGORIES } from '$lib/domain/shop-category';
// #3151 slice2 (ADR-0066): icon の値域は「grapheme 数」で判定する。grapheme 計数は activity と
// 同一実装 (countIconGraphemes) を共有し、値でなく述語を SSOT 化する (ADR-0066 原則 2)。
import { countIconGraphemes } from './activity';

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

// ============================================================
// ごほうび 値域 SSOT (#3151 slice2 / ADR-0066)
// ============================================================
// domain schema (本ファイル grantSpecialRewardSchema / rewardTemplateSchema) と wire schema
// (src/lib/marketplace/schemas/reward-set-schema.ts) の両方が本定数を参照する。
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
 * ごほうび icon 値域 (1〜2 grapheme) 判定。domain / wire schema の共有 oracle (#3151)。
 * 旧 domain 側 `max(10)` (UTF-16 units 基準) は ZWJ 連結絵文字 1 個 (👨‍👩‍👧‍👦 = 11 units) を弾き、
 * wire 側 `maxLength(20)` はそれを受理していたため両者が非対称だった。grapheme 判定への統一で
 * 「単一の絵文字」という意図を表現方式ごと SSOT 化し、domain / wire を同一境界に揃える。
 */
export function isValidRewardIcon(val: string): boolean {
	const count = countIconGraphemes(val);
	return count >= REWARD_ICON_MIN_GRAPHEMES && count <= REWARD_ICON_MAX_GRAPHEMES;
}

// ============================================================
// field 単位の Valibot schema (domain / wire 共有 SSOT、#3852 Phase B-0)
// ============================================================
// 旧: 同じ title/points/icon/category/description の shape を domain Zod と wire Valibot で 2 回宣言。
// 新: field pipe を本節に 1 回だけ定義し、domain object (下記) と wire object (reward-set-schema.ts)
// の双方が import して組み立てる。構造の二重定義を排し、境界値の再ドリフトを構造的に不可能にする。

/** ごほうびカテゴリ (6 値の登録カテゴリ、shopCategory とは直交軸) */
export const rewardCategorySchema = v.picklist(
	REWARD_CATEGORIES,
	'category は REWARD_CATEGORIES のいずれかで指定してください',
);

// #3147: ショップ陳列系統 (physical/money/privilege)。RewardCategory(6値)とは直交する軸。
// SHOP_CATEGORIES は shop-category.ts の SSOT を再利用 (重複定義しない)。
export const shopCategorySchema = v.picklist(
	SHOP_CATEGORIES,
	'shopCategory は SHOP_CATEGORIES のいずれかで指定してください',
);

/** ごほうび名 (1〜100 文字) */
export const rewardTitleSchema = v.pipe(
	v.string('ごほうび名は文字列で指定してください'),
	v.minLength(REWARD_TITLE_MIN, 'ごほうび名は必須です'),
	v.maxLength(REWARD_TITLE_MAX, `ごほうび名は ${REWARD_TITLE_MAX} 文字以内で指定してください`),
);

/** ごほうびポイント (1〜10000 の整数) */
export const rewardPointsSchema = v.pipe(
	v.number('ポイントは数値で指定してください'),
	v.integer('ポイントは整数で指定してください'),
	v.minValue(REWARD_POINTS_MIN, `ポイントは ${REWARD_POINTS_MIN} 以上で指定してください`),
	v.maxValue(REWARD_POINTS_MAX, `ポイントは ${REWARD_POINTS_MAX} 以下で指定してください`),
);

/**
 * ごほうび icon (present 時、1〜2 grapheme の絵文字)。
 * icon を「省略可」にするかは object 側で `v.optional(rewardIconSchema)` で表現する。
 * wire 経路 (export→restore) は DB の null icon を既定化してから渡すため icon 必須で使う。
 */
export const rewardIconSchema = v.pipe(
	v.string(),
	v.minLength(1, 'アイコンは必須です'),
	v.check(isValidRewardIcon, 'アイコンは1〜2つの絵文字で指定してください'),
);

/** ごほうび説明 (present 時、最大 500 文字) */
export const rewardDescriptionSchema = v.pipe(v.string(), v.maxLength(REWARD_DESCRIPTION_MAX));

/**
 * childId 境界 schema (query / body 由来 string と旧クライアント互換 number を受け branded 化する)。
 * id-schema.ts (Zod) の childIdSchema と等価な Valibot 版。id-schema 全体の Valibot 化は special-reward
 * の scope 外 (activity/category 等 他 schema へ波及するため #3852 Phase B-0 では本 field のみ移行)。
 */
const rewardChildIdSchema = v.pipe(
	v.union([v.pipe(v.string(), v.minLength(1)), v.pipe(v.number(), v.integer(), v.minValue(1))]),
	v.transform((val): ChildId => asChildId(val)),
);

// ============================================================
// domain object schema (Valibot、#3852 Phase B-0)
// ============================================================

export const grantSpecialRewardSchema = v.object({
	childId: rewardChildIdSchema,
	title: rewardTitleSchema,
	description: v.optional(rewardDescriptionSchema),
	points: rewardPointsSchema,
	icon: v.optional(rewardIconSchema),
	category: rewardCategorySchema,
	// #3147: 親が選ぶショップ陳列系統。省略時は表示側 deriveShopCategory に委ねる
	shopCategory: v.optional(shopCategorySchema),
});

export const specialRewardQuerySchema = v.object({
	childId: rewardChildIdSchema,
});

export const rewardTemplateSchema = v.object({
	title: rewardTitleSchema,
	points: rewardPointsSchema,
	icon: v.optional(rewardIconSchema),
	category: rewardCategorySchema,
});

export const rewardTemplatesArraySchema = v.array(rewardTemplateSchema);
