/**
 * Marketplace `challenge-set` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 *
 * **SSOT 整合**: 実装 SSOT は `src/lib/domain/marketplace-item.ts` の `ChallengeSetPayload` interface
 * (#2297 で導入)。本 schema は当該 interface の形 (monthDay / durationDays / categoryId 1-5 /
 * baseTarget / rewardPoints / icon) と完全一致させる。参照データ:
 * `src/lib/data/marketplace/challenge-sets/japan-annual-events.json` (15 件、年間行事 challenge セット)。
 *
 * **協力タイプ固定**: EPIC #2294 ② で競争タイプ UI が削除されたため、本 schema でも competitive
 * variant を持たず cooperative 固定とする (interface 側コメントと整合)。期間は monthDay (MM-DD) +
 * durationDays で論理表現し、import 時に service 側で当該年の日付に展開する。
 */

import * as v from 'valibot';

/** challenge-set item: 単一のチャレンジ (#2297 ChallengeSetPayload interface 整合) */
export const ChallengeSetItemSchema = v.object({
	title: v.pipe(
		v.string('title は文字列で指定してください'),
		v.minLength(1, 'title は必須です'),
		v.maxLength(100, 'title は 100 文字以内で指定してください'),
	),
	description: v.pipe(
		v.string('description は文字列で指定してください'),
		v.minLength(1, 'description は必須です'),
		v.maxLength(500, 'description は 500 文字以内で指定してください'),
	),
	/** 'MM-DD' (例: '03-03' = ひな祭り)。毎年同月日に開催される年間行事の論理表現 */
	monthDay: v.pipe(
		v.string('monthDay は文字列で指定してください'),
		v.regex(
			/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
			'monthDay は MM-DD 形式 (01-01 〜 12-31) で指定してください',
		),
	),
	/** 期間 (日数)。startDate = monthDay の (durationDays - 1) 日前。endDate = monthDay */
	durationDays: v.pipe(
		v.number('durationDays は数値で指定してください'),
		v.integer('durationDays は整数で指定してください'),
		v.minValue(1, 'durationDays は 1 以上で指定してください'),
		v.maxValue(90, 'durationDays は 90 以下で指定してください'),
	),
	/** 1=undou 2=benkyou 3=seikatsu 4=kouryuu 5=souzou */
	categoryId: v.picklist(
		[1, 2, 3, 4, 5] as const,
		'categoryId は 1 (運動) / 2 (勉強) / 3 (生活) / 4 (交流) / 5 (創造) のいずれかで指定してください',
	),
	/** 達成目標 (例: 累積 10 回) */
	baseTarget: v.pipe(
		v.number('baseTarget は数値で指定してください'),
		v.integer('baseTarget は整数で指定してください'),
		v.minValue(1, 'baseTarget は 1 以上で指定してください'),
		v.maxValue(1000, 'baseTarget は 1000 以下で指定してください'),
	),
	/** 報酬ポイント */
	rewardPoints: v.pipe(
		v.number('rewardPoints は数値で指定してください'),
		v.integer('rewardPoints は整数で指定してください'),
		v.minValue(0, 'rewardPoints は 0 以上で指定してください'),
		v.maxValue(10000, 'rewardPoints は 10000 以下で指定してください'),
	),
	icon: v.pipe(
		v.string('icon は文字列で指定してください'),
		v.minLength(1, 'icon は必須です'),
		v.maxLength(10, 'icon は 10 文字以内で指定してください'),
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
