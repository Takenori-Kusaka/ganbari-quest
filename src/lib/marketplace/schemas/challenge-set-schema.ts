/**
 * Marketplace `challenge-set` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 *
 * **SSOT 整合**: 実装 SSOT は `src/lib/domain/marketplace-item.ts` の `ChallengeSetPayload` interface
 * (#2297 で導入)。本 schema は当該 interface の形 (monthDay / durationDays / categoryId 1-5 /
 * baseTarget / rewardPoints / icon) と完全一致させる。参照データ:
 * `tests/fixtures/marketplace/challenge-sets/japan-annual-events.json` (15 件、年間行事 challenge セット)。
 *
 * **値域 SSOT (#3151 slice4 / ADR-0066)**: 値域 literal の直書きを禁止し、domain 層の値域 SSOT 定数
 * (`$lib/domain/validation/challenge-set.ts`) を参照する。domain Zod (challengeSetItemSchema) と本
 * wire schema の値域一致 (domain⊆wire) は tests/unit/architecture/schema-range-ssot.test.ts が
 * boundary probe で機械表明する。
 *
 * **協力タイプ固定**: EPIC #2294 ② で競争タイプ UI が削除されたため、本 schema でも competitive
 * variant を持たず cooperative 固定とする (interface 側コメントと整合)。期間は monthDay (MM-DD) +
 * durationDays で論理表現し、import 時に service 側で当該年の日付に展開する。
 */

import * as v from 'valibot';
import { CATEGORIES, CATEGORY_CODES, CATEGORY_NUMERIC_IDS } from '$lib/domain/categories.js';
import {
	CHALLENGE_BASE_TARGET_MAX,
	CHALLENGE_BASE_TARGET_MIN,
	CHALLENGE_DESCRIPTION_MAX,
	CHALLENGE_DESCRIPTION_MIN,
	CHALLENGE_DURATION_DAYS_MAX,
	CHALLENGE_DURATION_DAYS_MIN,
	CHALLENGE_MONTH_DAY_REGEX,
	CHALLENGE_REWARD_POINTS_MAX,
	CHALLENGE_REWARD_POINTS_MIN,
	CHALLENGE_TITLE_MAX,
	CHALLENGE_TITLE_MIN,
	isValidChallengeIcon,
} from '$lib/domain/validation/challenge-set.js';

/** picklist エラーメッセージ用の "1 (うんどう) / 2 (べんきょう) / ..." 列挙 (SSOT 派生、#3607) */
const CATEGORY_ID_CHOICES = CATEGORY_CODES.map(
	(code) => `${CATEGORIES[code].legacyNumericId} (${CATEGORIES[code].name})`,
).join(' / ');

/** challenge-set item: 単一のチャレンジ (#2297 ChallengeSetPayload interface 整合) */
export const ChallengeSetItemSchema = v.object({
	title: v.pipe(
		v.string('title は文字列で指定してください'),
		v.minLength(CHALLENGE_TITLE_MIN, 'title は必須です'),
		v.maxLength(CHALLENGE_TITLE_MAX, `title は ${CHALLENGE_TITLE_MAX} 文字以内で指定してください`),
	),
	description: v.pipe(
		v.string('description は文字列で指定してください'),
		v.minLength(CHALLENGE_DESCRIPTION_MIN, 'description は必須です'),
		v.maxLength(
			CHALLENGE_DESCRIPTION_MAX,
			`description は ${CHALLENGE_DESCRIPTION_MAX} 文字以内で指定してください`,
		),
	),
	/** 'MM-DD' (例: '03-03' = ひな祭り)。毎年同月日に開催される年間行事の論理表現 */
	monthDay: v.pipe(
		v.string('monthDay は文字列で指定してください'),
		v.regex(
			CHALLENGE_MONTH_DAY_REGEX,
			'monthDay は MM-DD 形式 (01-01 〜 12-31) で指定してください',
		),
	),
	/** 期間 (日数)。startDate = monthDay の (durationDays - 1) 日前。endDate = monthDay */
	durationDays: v.pipe(
		v.number('durationDays は数値で指定してください'),
		v.integer('durationDays は整数で指定してください'),
		v.minValue(
			CHALLENGE_DURATION_DAYS_MIN,
			`durationDays は ${CHALLENGE_DURATION_DAYS_MIN} 以上で指定してください`,
		),
		v.maxValue(
			CHALLENGE_DURATION_DAYS_MAX,
			`durationDays は ${CHALLENGE_DURATION_DAYS_MAX} 以下で指定してください`,
		),
	),
	/**
	 * legacy 数値カテゴリ id ($lib/domain/categories.ts SSOT の `legacyNumericId` 投影、#3607)。
	 *
	 * payload 内で自己完結する「意味的カテゴリ enum」であり、DB エンティティの
	 * branded CategoryId (string、src/lib/domain/ids.ts) とは別物 (#3606 棚卸しで
	 * runtime break なしを確認済)。値域はカテゴリ SSOT から派生し、カテゴリ追加時は
	 * SSOT 1 エントリ追記で本 picklist にも自動伝播する。
	 */
	categoryId: v.picklist(
		CATEGORY_NUMERIC_IDS,
		`categoryId は ${CATEGORY_ID_CHOICES} のいずれかで指定してください`,
	),
	/** 達成目標 (例: 累積 10 回) */
	baseTarget: v.pipe(
		v.number('baseTarget は数値で指定してください'),
		v.integer('baseTarget は整数で指定してください'),
		v.minValue(
			CHALLENGE_BASE_TARGET_MIN,
			`baseTarget は ${CHALLENGE_BASE_TARGET_MIN} 以上で指定してください`,
		),
		v.maxValue(
			CHALLENGE_BASE_TARGET_MAX,
			`baseTarget は ${CHALLENGE_BASE_TARGET_MAX} 以下で指定してください`,
		),
	),
	/** 報酬ポイント */
	rewardPoints: v.pipe(
		v.number('rewardPoints は数値で指定してください'),
		v.integer('rewardPoints は整数で指定してください'),
		v.minValue(
			CHALLENGE_REWARD_POINTS_MIN,
			`rewardPoints は ${CHALLENGE_REWARD_POINTS_MIN} 以上で指定してください`,
		),
		v.maxValue(
			CHALLENGE_REWARD_POINTS_MAX,
			`rewardPoints は ${CHALLENGE_REWARD_POINTS_MAX} 以下で指定してください`,
		),
	),
	// icon は domain と同一 oracle (isValidChallengeIcon、1〜2 grapheme) で判定 (#3151 slice4)。
	// 旧 maxLength(20) (UTF-16 units 基準) は domain 側 (無制限) と非対称で、ZWJ 連結絵文字 2 個
	// (22 units) を弾き / 絵文字 3 個以上を受理していた。isValidChallengeIcon 共有で表現方式ごと統一。
	icon: v.pipe(
		v.string('icon は文字列で指定してください'),
		v.minLength(1, 'icon は必須です'),
		v.check(isValidChallengeIcon, 'icon は 1〜2 個の絵文字で指定してください'),
	),
});

export const ChallengeSetPayloadSchema = v.object({
	challenges: v.pipe(
		v.array(ChallengeSetItemSchema),
		v.minLength(1, 'challenges は 1 件以上含めてください'),
	),
});

export type ChallengeSetItem = v.InferOutput<typeof ChallengeSetItemSchema>;
export type ChallengeSetPayload = v.InferOutput<typeof ChallengeSetPayloadSchema>;
