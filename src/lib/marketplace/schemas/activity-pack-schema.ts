/**
 * Marketplace `activity-pack` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 * Issue #3151 (ADR-0066): 値域 literal の直書きを禁止し、domain 層の値域 SSOT 定数
 * (`$lib/domain/validation/activity.ts`) を参照する。domain Zod (createActivitySchema) と
 * 本 wire schema の値域一致 (domain⊆wire) は tests/unit/architecture/schema-range-ssot.test.ts
 * が機械表明する。
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `ActivityPackPayload`
 * Standard Schema spec 対応で将来 Zod/ArkType 切替自由度を保持。
 */

import * as v from 'valibot';
import {
	ACTIVITY_AGE_MAX,
	ACTIVITY_AGE_MIN,
	ACTIVITY_BASE_POINTS_MAX,
	ACTIVITY_BASE_POINTS_MIN,
	ACTIVITY_DESCRIPTION_MAX,
	ACTIVITY_NAME_MAX,
	ACTIVITY_NAME_MIN,
	ACTIVITY_TRIGGER_HINT_MAX,
	CATEGORY_CODES,
	GRADE_LEVELS,
	isValidActivityIcon,
} from '$lib/domain/validation/activity.js';

/** activity-pack item: 単一の活動 (`ActivityPackPayload['activities'][number]` の rebuild) */
export const ActivityPackItemSchema = v.object({
	name: v.pipe(
		v.string('活動名は文字列で指定してください'),
		v.minLength(ACTIVITY_NAME_MIN, '活動名は必須です'),
		v.maxLength(ACTIVITY_NAME_MAX, `活動名は ${ACTIVITY_NAME_MAX} 文字以内で指定してください`),
	),
	categoryCode: v.picklist(
		CATEGORY_CODES,
		'categoryCode は CATEGORY_CODES のいずれかで指定してください',
	),
	// icon は domain と同一 oracle (isValidActivityIcon、1〜2 grapheme) で判定 (#3151)。
	// 旧 maxLength(20) (UTF-16 units 基準) は ZWJ 連結絵文字 2 個 (22 units) を弾き domain⊆wire を破っていた。
	icon: v.pipe(
		v.string(),
		v.minLength(1, 'icon は必須です'),
		v.check(isValidActivityIcon, 'icon は 1〜2 個の絵文字で指定してください'),
	),
	basePoints: v.pipe(
		v.number('basePoints は数値で指定してください'),
		v.integer('basePoints は整数で指定してください'),
		v.minValue(
			ACTIVITY_BASE_POINTS_MIN,
			`basePoints は ${ACTIVITY_BASE_POINTS_MIN} 以上で指定してください`,
		),
		v.maxValue(
			ACTIVITY_BASE_POINTS_MAX,
			`basePoints は ${ACTIVITY_BASE_POINTS_MAX} 以下で指定してください`,
		),
	),
	/** `null` も許容 (年齢制限なし) */
	ageMin: v.nullable(
		v.pipe(v.number(), v.integer(), v.minValue(ACTIVITY_AGE_MIN), v.maxValue(ACTIVITY_AGE_MAX)),
	),
	ageMax: v.nullable(
		v.pipe(v.number(), v.integer(), v.minValue(ACTIVITY_AGE_MIN), v.maxValue(ACTIVITY_AGE_MAX)),
	),
	gradeLevel: v.nullable(v.picklist(GRADE_LEVELS)),
	triggerHint: v.optional(v.pipe(v.string(), v.maxLength(ACTIVITY_TRIGGER_HINT_MAX))),
	description: v.optional(v.pipe(v.string(), v.maxLength(ACTIVITY_DESCRIPTION_MAX))),
	/** #1758 / #1709-D: import 時の「今日のおやくそく」推奨候補 */
	mustDefault: v.optional(v.boolean()),
});

/** `MarketplacePayloadMap['activity-pack']` の Valibot schema */
export const ActivityPackPayloadSchema = v.object({
	activities: v.pipe(
		v.array(ActivityPackItemSchema),
		v.minLength(1, 'activities は 1 件以上含めてください'),
	),
});

export type ActivityPackItem = v.InferOutput<typeof ActivityPackItemSchema>;
export type ActivityPackPayload = v.InferOutput<typeof ActivityPackPayloadSchema>;
