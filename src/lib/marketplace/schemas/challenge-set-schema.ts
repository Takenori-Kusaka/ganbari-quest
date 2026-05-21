/**
 * Marketplace `challenge-set` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 *
 * **新規 type**: EPIC #2362 P3 #2364 で正式にマーケットプレイス対応する challenge-set。
 * 既存 `marketplace-item.ts` には未定義のため、本 schema が SSOT になる。
 *
 * Sibling / Auto challenge ドメイン (src/lib/server/db/types/index.ts SiblingChallenge / AutoChallenge)
 * から融合した「公式 challenge セット」形を定義する。実 import service は #2364 (EPIC P3 #7) で実装。
 */

import * as v from 'valibot';
import { CATEGORY_CODES } from '$lib/domain/validation/activity.js';

/** challenge の種別 (sibling-challenge.challengeType と整合) */
export const CHALLENGE_TYPES = ['cooperative', 'competitive'] as const;
export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

/** 周期種別 */
export const PERIOD_TYPES = ['daily', 'weekly', 'monthly'] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

/** challenge-set item: 単一のチャレンジ */
export const ChallengeSetItemSchema = v.object({
	title: v.pipe(
		v.string('title は文字列で指定してください'),
		v.minLength(1, 'title は必須です'),
		v.maxLength(100, 'title は 100 文字以内で指定してください'),
	),
	description: v.optional(v.pipe(v.string(), v.maxLength(500))),
	icon: v.pipe(v.string(), v.minLength(1, 'icon は必須です'), v.maxLength(10)),
	challengeType: v.picklist(
		CHALLENGE_TYPES,
		'challengeType は CHALLENGE_TYPES のいずれかで指定してください',
	),
	periodType: v.picklist(PERIOD_TYPES, 'periodType は PERIOD_TYPES のいずれかで指定してください'),
	/** 対象カテゴリ。未指定時は全カテゴリ対象 */
	categoryCode: v.optional(v.picklist(CATEGORY_CODES)),
	/** 達成目標 (例: 累積 10 回) */
	targetCount: v.pipe(
		v.number('targetCount は数値で指定してください'),
		v.integer('targetCount は整数で指定してください'),
		v.minValue(1, 'targetCount は 1 以上で指定してください'),
		v.maxValue(1000, 'targetCount は 1000 以下で指定してください'),
	),
	/** 報酬ポイント */
	rewardPoints: v.pipe(
		v.number(),
		v.integer(),
		v.minValue(0, 'rewardPoints は 0 以上で指定してください'),
		v.maxValue(10000, 'rewardPoints は 10000 以下で指定してください'),
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
