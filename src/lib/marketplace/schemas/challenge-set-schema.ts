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
 * (`$lib/domain/validation/challenge-set.ts`) を参照する。
 * **Issue #3852 Phase B-2 (EPIC #3151 選択肢 B)**: 値域「定数」だけでなく field「schema 構造」も domain
 * 層の field pipe を import して組み立てる。これにより旧来 domain / wire で 2 回宣言していた
 * title/description/monthDay/durationDays/baseTarget/rewardPoints/icon の shape が単一定義になり、境界値
 * の再ドリフト (#3132 class) が構造的に不可能になる (activity Phase B-1 / #3860 と同型)。categoryId は
 * wire 固有 (domain は値域でない意味的カテゴリ enum を対象外) のため本 schema に残す。domain Valibot
 * (challengeSetItemSchema) と本 wire schema の値域一致 (domain⊆wire) は
 * tests/unit/architecture/schema-range-ssot.test.ts が boundary probe で機械表明する。
 *
 * **協力タイプ固定**: EPIC #2294 ② で競争タイプ UI が削除されたため、本 schema でも competitive
 * variant を持たず cooperative 固定とする (interface 側コメントと整合)。期間は monthDay (MM-DD) +
 * durationDays で論理表現し、import 時に service 側で当該年の日付に展開する。
 */

import * as v from 'valibot';
import { CATEGORIES, CATEGORY_CODES, CATEGORY_NUMERIC_IDS } from '$lib/domain/categories.js';
import {
	challengeBaseTargetSchema,
	challengeDescriptionSchema,
	challengeDurationDaysSchema,
	challengeIconSchema,
	challengeMonthDaySchema,
	challengeRewardPointsSchema,
	challengeTitleSchema,
} from '$lib/domain/validation/challenge-set.js';

/** picklist エラーメッセージ用の "1 (うんどう) / 2 (べんきょう) / ..." 列挙 (SSOT 派生、#3607) */
const CATEGORY_ID_CHOICES = CATEGORY_CODES.map(
	(code) => `${CATEGORIES[code].legacyNumericId} (${CATEGORIES[code].name})`,
).join(' / ');

/** challenge-set item: 単一のチャレンジ (#2297 ChallengeSetPayload interface 整合)。
 * title/description/monthDay/durationDays/baseTarget/rewardPoints/icon は domain 層 field schema の再利用。
 * categoryId のみ wire 固有 (意味的カテゴリ enum、値域でないため domain range validator 対象外)。 */
export const ChallengeSetItemSchema = v.object({
	title: challengeTitleSchema,
	description: challengeDescriptionSchema,
	/** 'MM-DD' (例: '03-03' = ひな祭り)。毎年同月日に開催される年間行事の論理表現 */
	monthDay: challengeMonthDaySchema,
	/** 期間 (日数)。startDate = monthDay の (durationDays - 1) 日前。endDate = monthDay */
	durationDays: challengeDurationDaysSchema,
	/**
	 * legacy 数値カテゴリ id ($lib/domain/categories.ts SSOT の `legacyNumericId` 投影、#3607)。
	 *
	 * payload 内で自己完結する「意味的カテゴリ enum」であり、DB エンティティの
	 * branded CategoryId (string、src/lib/domain/ids.ts) とは別物 (#3606 棚卸しで
	 * runtime break なしを確認済)。値域はカテゴリ SSOT から派生し、カテゴリ追加時は
	 * SSOT 1 エントリ追記で本 picklist にも自動伝播する。値域でない enum のため domain range
	 * validator (challenge-set.ts) の対象外で、wire 固有の field として本 schema に残す。
	 */
	categoryId: v.picklist(
		CATEGORY_NUMERIC_IDS,
		`categoryId は ${CATEGORY_ID_CHOICES} のいずれかで指定してください`,
	),
	/** 達成目標 (例: 累積 10 回) */
	baseTarget: challengeBaseTargetSchema,
	/** 報酬ポイント */
	rewardPoints: challengeRewardPointsSchema,
	// icon は domain と同一 oracle (isValidChallengeIcon、1〜2 grapheme) で判定 (#3151 slice4)。
	// 旧 maxLength(20) (UTF-16 units 基準) は ZWJ 連結絵文字 2 個 (22 units) を弾き domain⊆wire を破っていた。
	icon: challengeIconSchema,
});

export const ChallengeSetPayloadSchema = v.object({
	challenges: v.pipe(
		v.array(ChallengeSetItemSchema),
		v.minLength(1, 'challenges は 1 件以上含めてください'),
	),
});

export type ChallengeSetItem = v.InferOutput<typeof ChallengeSetItemSchema>;
export type ChallengeSetPayload = v.InferOutput<typeof ChallengeSetPayloadSchema>;
