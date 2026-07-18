/**
 * Marketplace `rule-preset` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 * Issue #3151 slice4 (ADR-0066): 値域 literal の直書きを禁止し、domain 層の値域 SSOT 定数
 * (`$lib/domain/validation/rule-preset.ts`) を参照する。
 * Issue #3852 Phase B-2 (EPIC #3151 選択肢 B): 値域「定数」だけでなく field「schema 構造」も domain 層
 * の field pipe を import して組み立てる。これにより旧来 domain / wire で 2 回宣言していた
 * title/description/icon/pointCost/pointBonus の shape が単一定義になり、境界値の再ドリフト
 * (#3132 class) が構造的に不可能になる (activity Phase B-1 / #3860 と同型)。domain Valibot
 * (rulePresetItemSchema) と本 wire schema の値域一致 (domain⊆wire) は
 * tests/unit/architecture/schema-range-ssot.test.ts が boundary probe で機械表明する。
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `RulePresetPayload`
 */

import * as v from 'valibot';
import {
	ruleDescriptionSchema,
	ruleIconSchema,
	rulePointSchema,
	ruleTitleSchema,
} from '$lib/domain/validation/rule-preset.js';

/** ルールタイプ */
export const RULE_TYPES = ['exchange', 'bonus', 'penalty', 'special'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/** rule-preset item: 単一のルール (`RulePresetPayload['rules'][number]` の rebuild)。
 * title/description/icon/pointCost/pointBonus は domain 層 field schema (rule-preset.ts) の再利用。 */
export const RulePresetItemSchema = v.object({
	title: ruleTitleSchema,
	description: ruleDescriptionSchema,
	// icon は domain と同一 oracle (isValidRuleIcon、1〜2 grapheme) で判定 (#3151 slice4)。
	// 旧 maxLength(20) (UTF-16 units 基準) は ZWJ 連結絵文字 2 個 (22 units) を弾き domain⊆wire を破っていた。
	icon: ruleIconSchema,
	pointCost: v.optional(rulePointSchema),
	pointBonus: v.optional(rulePointSchema),
});

export const RulePresetPayloadSchema = v.object({
	ruleType: v.picklist(RULE_TYPES, 'ruleType は RULE_TYPES のいずれかで指定してください'),
	rules: v.pipe(v.array(RulePresetItemSchema), v.minLength(1, 'rules は 1 件以上含めてください')),
});

export type RulePresetItem = v.InferOutput<typeof RulePresetItemSchema>;
export type RulePresetPayload = v.InferOutput<typeof RulePresetPayloadSchema>;
