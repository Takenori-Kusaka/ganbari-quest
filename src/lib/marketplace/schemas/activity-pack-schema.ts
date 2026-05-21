/**
 * Marketplace `activity-pack` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `ActivityPackPayload`
 * Standard Schema spec 対応で将来 Zod/ArkType 切替自由度を保持。
 */

import * as v from 'valibot';
import { CATEGORY_CODES, GRADE_LEVELS } from '$lib/domain/validation/activity.js';

/** activity-pack item: 単一の活動 (`ActivityPackPayload['activities'][number]` の rebuild) */
export const ActivityPackItemSchema = v.object({
	name: v.pipe(
		v.string('活動名は文字列で指定してください'),
		v.minLength(1, '活動名は必須です'),
		v.maxLength(50, '活動名は 50 文字以内で指定してください'),
	),
	categoryCode: v.picklist(
		CATEGORY_CODES,
		'categoryCode は CATEGORY_CODES のいずれかで指定してください',
	),
	icon: v.pipe(
		v.string(),
		v.minLength(1, 'icon は必須です'),
		v.maxLength(10, 'icon は 10 文字以内です'),
	),
	basePoints: v.pipe(
		v.number('basePoints は数値で指定してください'),
		v.integer('basePoints は整数で指定してください'),
		v.minValue(1, 'basePoints は 1 以上で指定してください'),
		v.maxValue(10000, 'basePoints は 10000 以下で指定してください'),
	),
	/** `null` も許容 (年齢制限なし) */
	ageMin: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(18))),
	ageMax: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(18))),
	gradeLevel: v.nullable(v.picklist(GRADE_LEVELS)),
	triggerHint: v.optional(v.pipe(v.string(), v.maxLength(200))),
	description: v.optional(v.pipe(v.string(), v.maxLength(500))),
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
