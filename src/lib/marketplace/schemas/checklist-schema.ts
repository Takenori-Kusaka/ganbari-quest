/**
 * Marketplace `checklist` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `ChecklistPayload`
 */

import * as v from 'valibot';

/** チェックリストの実施タイミング */
export const CHECKLIST_TIMINGS = ['morning', 'evening', 'weekend', 'daily', 'weekly'] as const;
export type ChecklistTiming = (typeof CHECKLIST_TIMINGS)[number];

/** checklist item: 単一の確認項目 (`ChecklistPayload['items'][number]` の rebuild) */
export const ChecklistItemSchema = v.object({
	label: v.pipe(
		v.string('label は文字列で指定してください'),
		v.minLength(1, 'label は必須です'),
		v.maxLength(100, 'label は 100 文字以内で指定してください'),
	),
	// icon は単一の emoji を想定 (ZWJ 連結 emoji 例: 👨‍👩‍👧‍👦 = 11 UTF-16 code units)
	// を許容するため maxLength=20 (ZWJ profession sequences は ~17 で安全圏)
	icon: v.pipe(v.string(), v.minLength(1, 'icon は必須です'), v.maxLength(20)),
	order: v.pipe(
		v.number('order は数値で指定してください'),
		v.integer('order は整数で指定してください'),
		v.minValue(0, 'order は 0 以上で指定してください'),
	),
});

export const ChecklistPayloadSchema = v.object({
	timing: v.picklist(CHECKLIST_TIMINGS, 'timing は CHECKLIST_TIMINGS のいずれかで指定してください'),
	items: v.pipe(v.array(ChecklistItemSchema), v.minLength(1, 'items は 1 件以上含めてください')),
});

export type ChecklistItem = v.InferOutput<typeof ChecklistItemSchema>;
export type ChecklistPayload = v.InferOutput<typeof ChecklistPayloadSchema>;
