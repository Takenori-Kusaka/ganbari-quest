// src/lib/domain/shop-category.ts
// ごほうびショップ 3 系統 (#1336 / #2157) SSOT
//
// preset-rewards.ts の `ShopCategory` を ごほうびショップ UI 全体で利用するための
// domain 層エクスポート + DB に永続化されていない reward に対する
// ヒューリスティック判定関数を提供する。
//
// 背景:
// - `special_rewards.category` は `RewardCategory` (academic/sports/social/creative/life/other)
//   であり、UI 上の 3 系統 (実物/お小遣い/特権) とは独立した分類軸。
// - `special_rewards.shop_category` 列は #3150 で追加済 (schema.ts / create-tables.ts)。
//   preset / 取込時に `shopCategory` が永続化される。
// - `deriveShopCategory()` は列が null の場合 (列追加前の legacy 行 / 未指定 reward) の
//   fallback として用いる。呼び出し側は `reward.shopCategory ?? deriveShopCategory(...)` で
//   「保存値優先・無ければ title / icon / description から決定的ルールで派生」を実現する。

import type { ShopCategory } from '$lib/data/preset-rewards';

export type { ShopCategory };

export const SHOP_CATEGORIES = ['physical', 'money', 'privilege'] as const;

/**
 * reward から `ShopCategory` を派生する決定的ヒューリスティック。
 *
 * 優先順位:
 *   1. title / description に「おこづかい」「お小遣い」「ちょきん」「貯金」「円」を含む → money
 *   2. icon が money 系 (🪙 💴 💵 💰) → money
 *   3. title / description に特権語彙 (時間・けん・リクエスト・おでかけ・えいが・ゲーム
 *      時間・YouTube・ともだち・かぞくで・夜更かし・朝寝坊 等) を含む → privilege
 *   4. icon が privilege 系 (🌙 😴 🎮 📺 🚗 🍽️ 🎬 👫 🎲 🐕 🍕 ✈️) → privilege
 *   5. それ以外 → physical (現物デフォルト)
 *
 * Pre-PMF Pragma: 厳密分類ではなく「3 タブで概ね妥当な振り分けになる」ことを目指す。
 * 誤判定が事業価値を毀損する場面 (法務・課金等) では使用しないこと。
 */
export function deriveShopCategory(reward: {
	title: string;
	icon?: string | null;
	description?: string | null;
}): ShopCategory {
	const haystack = `${reward.title} ${reward.description ?? ''}`;
	const icon = reward.icon ?? '';

	// 1. money: 通貨・お小遣い系語彙
	if (
		/おこづかい|お小遣い|こづかい|貯金|ちょきん|預金|よきん/.test(haystack) ||
		/[0-9０-９]+\s*円/.test(haystack) ||
		MONEY_ICONS.has(icon)
	) {
		return 'money';
	}

	// 2. privilege: 体験・許可・特権語彙
	if (PRIVILEGE_PATTERN.test(haystack) || PRIVILEGE_ICONS.has(icon)) {
		return 'privilege';
	}

	// 3. physical: 現物デフォルト
	return 'physical';
}

const MONEY_ICONS = new Set(['🪙', '💴', '💵', '💰', '💸']);

const PRIVILEGE_ICONS = new Set([
	'🌙',
	'😴',
	'🎮',
	'📺',
	'🚗',
	'🍽️',
	'🎬',
	'👫',
	'🎲',
	'🐕',
	'🍕',
	'✈️',
	'🎟️',
	'🎫',
]);

const PRIVILEGE_PATTERN =
	/時間|けん(?!か)|チケット|リクエスト|おでかけ|お出かけ|外出|えいが|映画|ゲーム|youtube|ユーチューブ|ともだち|友達|友だち|かぞく|家族|よふかし|夜更かし|あさねぼう|朝寝坊|ペット|旅行|りょこう|外食|がいしょく|メニュー|おはなし|お話し|読み聞かせ/i;
