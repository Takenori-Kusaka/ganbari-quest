/**
 * Marketplace `checklist` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 * Issue #3151 slice3 (ADR-0066): 値域 literal の直書きを禁止し、domain 層の値域 SSOT 定数
 * (`$lib/domain/validation/checklist.ts`) を参照する。domain Zod (checklistItemSchema) と
 * 本 wire schema の値域一致 (domain⊆wire) は tests/unit/architecture/schema-range-ssot.test.ts
 * が boundary probe で機械表明する。
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `ChecklistPayload`
 */

import * as v from 'valibot';
import {
	CHECKLIST_LABEL_MAX,
	CHECKLIST_LABEL_MIN,
	CHECKLIST_ORDER_MIN,
	isValidChecklistIcon,
} from '$lib/domain/validation/checklist.js';

/** チェックリストの実施タイミング */
export const CHECKLIST_TIMINGS = ['morning', 'evening', 'weekend', 'daily', 'weekly'] as const;
export type ChecklistTiming = (typeof CHECKLIST_TIMINGS)[number];

/** checklist item: 単一の確認項目 (`ChecklistPayload['items'][number]` の rebuild) */
export const ChecklistItemSchema = v.object({
	label: v.pipe(
		v.string('label は文字列で指定してください'),
		v.minLength(CHECKLIST_LABEL_MIN, 'label は必須です'),
		v.maxLength(CHECKLIST_LABEL_MAX, `label は ${CHECKLIST_LABEL_MAX} 文字以内で指定してください`),
	),
	// icon は domain と同一 oracle (isValidChecklistIcon、1〜2 grapheme) で判定 (#3151 slice3)。
	// 旧 maxLength(20) (UTF-16 units 基準) は domain 側 (無制限) と非対称で、ZWJ 連結絵文字 2 個
	// (22 units) を弾き / 絵文字 3 個以上を受理していた。isValidChecklistIcon 共有で表現方式ごと統一。
	icon: v.pipe(
		v.string(),
		v.minLength(1, 'icon は必須です'),
		v.check(isValidChecklistIcon, 'icon は 1〜2 個の絵文字で指定してください'),
	),
	order: v.pipe(
		v.number('order は数値で指定してください'),
		v.integer('order は整数で指定してください'),
		v.minValue(CHECKLIST_ORDER_MIN, `order は ${CHECKLIST_ORDER_MIN} 以上で指定してください`),
	),
});

export const ChecklistPayloadSchema = v.object({
	timing: v.picklist(CHECKLIST_TIMINGS, 'timing は CHECKLIST_TIMINGS のいずれかで指定してください'),
	items: v.pipe(v.array(ChecklistItemSchema), v.minLength(1, 'items は 1 件以上含めてください')),
});

export type ChecklistItem = v.InferOutput<typeof ChecklistItemSchema>;
export type ChecklistPayload = v.InferOutput<typeof ChecklistPayloadSchema>;
