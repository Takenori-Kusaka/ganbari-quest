/**
 * Marketplace `checklist` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 * Issue #3151 slice3 (ADR-0066): 値域 literal の直書きを禁止し、domain 層の値域 SSOT 定数
 * (`$lib/domain/validation/checklist.ts`) を参照する。
 * Issue #3852 Phase B-2 (EPIC #3151 選択肢 B): 値域「定数」だけでなく field「schema 構造」も domain 層
 * (`$lib/domain/validation/checklist.ts`) の field pipe を import して組み立てる。これにより
 * 旧来 domain / wire で 2 回宣言していた label/icon/order の shape が単一定義になり、境界値の再ドリフト
 * (#3132 class) が構造的に不可能になる (activity Phase B-1 / #3860 と同型)。domain Valibot
 * (checklistItemSchema) と本 wire schema の値域一致 (domain⊆wire) は
 * tests/unit/architecture/schema-range-ssot.test.ts が boundary probe で機械表明する。
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `ChecklistPayload`
 */

import * as v from 'valibot';
import {
	checklistIconSchema,
	checklistLabelSchema,
	checklistOrderSchema,
} from '$lib/domain/validation/checklist.js';

/** チェックリストの実施タイミング */
export const CHECKLIST_TIMINGS = ['morning', 'evening', 'weekend', 'daily', 'weekly'] as const;
export type ChecklistTiming = (typeof CHECKLIST_TIMINGS)[number];

/** checklist item: 単一の確認項目 (`ChecklistPayload['items'][number]` の rebuild)。
 * label/icon/order は domain 層 field schema (checklist.ts) の再利用。 */
export const ChecklistItemSchema = v.object({
	label: checklistLabelSchema,
	// icon は domain と同一 oracle (isValidChecklistIcon、1〜2 grapheme) で判定 (#3151 slice3)。
	// 旧 maxLength(20) (UTF-16 units 基準) は ZWJ 連結絵文字 2 個 (22 units) を弾き domain⊆wire を破っていた。
	icon: checklistIconSchema,
	order: checklistOrderSchema,
});

export const ChecklistPayloadSchema = v.object({
	timing: v.picklist(CHECKLIST_TIMINGS, 'timing は CHECKLIST_TIMINGS のいずれかで指定してください'),
	items: v.pipe(v.array(ChecklistItemSchema), v.minLength(1, 'items は 1 件以上含めてください')),
});

export type ChecklistItem = v.InferOutput<typeof ChecklistItemSchema>;
export type ChecklistPayload = v.InferOutput<typeof ChecklistPayloadSchema>;
