/**
 * Marketplace `activity-pack` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 * Issue #3151 (ADR-0066): 値域 literal の直書きを禁止し、domain 層の値域 SSOT 定数
 * (`$lib/domain/validation/activity.ts`) を参照する。domain Valibot (createActivitySchema) と
 * 本 wire schema の値域一致 (domain⊆wire) は tests/unit/architecture/schema-range-ssot.test.ts
 * が機械表明する。
 * Issue #3852 Phase B-1 (EPIC #3151 選択肢 B): 値域「定数」だけでなく field「schema 構造」も domain 層
 * (`$lib/domain/validation/activity.ts`) の field pipe を import して組み立てる。これにより
 * 旧来 domain / wire で 2 回宣言していた name/icon/basePoints/age/gradeLevel/triggerHint/description の
 * shape が単一定義になり、境界値の再ドリフト (#3132 class) が構造的に不可能になる (special-reward Phase
 * B-0 / #3853 と同型)。categoryCode / mustDefault は wire 固有 (domain は categoryId 軸) のため本 schema に残す。
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `ActivityPackPayload`
 * Standard Schema spec 対応で将来 Zod/ArkType 切替自由度を保持。
 */

import * as v from 'valibot';
import {
	activityAgeSchema,
	activityBasePointsSchema,
	activityDescriptionSchema,
	activityGradeLevelSchema,
	activityIconSchema,
	activityNameSchema,
	activityTriggerHintSchema,
	CATEGORY_CODES,
} from '$lib/domain/validation/activity.js';

/** activity-pack item: 単一の活動 (`ActivityPackPayload['activities'][number]` の rebuild)。
 * name/icon/basePoints/age/gradeLevel/triggerHint/description は domain 層 field schema (activity.ts) の再利用。 */
export const ActivityPackItemSchema = v.object({
	name: activityNameSchema,
	categoryCode: v.picklist(
		CATEGORY_CODES,
		'categoryCode は CATEGORY_CODES のいずれかで指定してください',
	),
	// icon は domain と同一 oracle (isValidActivityIcon、1〜2 grapheme) で判定 (#3151)。
	// 旧 maxLength(20) (UTF-16 units 基準) は ZWJ 連結絵文字 2 個 (22 units) を弾き domain⊆wire を破っていた。
	icon: activityIconSchema,
	basePoints: activityBasePointsSchema,
	/** `null` も許容 (年齢制限なし) */
	ageMin: v.nullable(activityAgeSchema),
	ageMax: v.nullable(activityAgeSchema),
	gradeLevel: v.nullable(activityGradeLevelSchema),
	triggerHint: v.optional(activityTriggerHintSchema),
	description: v.optional(activityDescriptionSchema),
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
