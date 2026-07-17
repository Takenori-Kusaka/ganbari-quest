/**
 * Marketplace `rule-preset` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 * Issue #3151 slice4 (ADR-0066): 値域 literal の直書きを禁止し、domain 層の値域 SSOT 定数
 * (`$lib/domain/validation/rule-preset.ts`) を参照する。domain Zod (rulePresetItemSchema) と本
 * wire schema の値域一致 (domain⊆wire) は tests/unit/architecture/schema-range-ssot.test.ts が
 * boundary probe で機械表明する。
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `RulePresetPayload`
 */

import * as v from 'valibot';
import {
	isValidRuleIcon,
	RULE_DESCRIPTION_MAX,
	RULE_DESCRIPTION_MIN,
	RULE_POINT_MAX,
	RULE_POINT_MIN,
	RULE_TITLE_MAX,
	RULE_TITLE_MIN,
} from '$lib/domain/validation/rule-preset.js';

/** ルールタイプ */
export const RULE_TYPES = ['exchange', 'bonus', 'penalty', 'special'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/** rule-preset item: 単一のルール (`RulePresetPayload['rules'][number]` の rebuild) */
export const RulePresetItemSchema = v.object({
	title: v.pipe(
		v.string('title は文字列で指定してください'),
		v.minLength(RULE_TITLE_MIN, 'title は必須です'),
		v.maxLength(RULE_TITLE_MAX, `title は ${RULE_TITLE_MAX} 文字以内で指定してください`),
	),
	description: v.pipe(
		v.string('description は文字列で指定してください'),
		v.minLength(RULE_DESCRIPTION_MIN, 'description は必須です'),
		v.maxLength(
			RULE_DESCRIPTION_MAX,
			`description は ${RULE_DESCRIPTION_MAX} 文字以内で指定してください`,
		),
	),
	// icon は domain と同一 oracle (isValidRuleIcon、1〜2 grapheme) で判定 (#3151 slice4)。
	// 旧 maxLength(20) (UTF-16 units 基準) は domain 側 (無制限) と非対称で、ZWJ 連結絵文字 2 個
	// (22 units) を弾き / 絵文字 3 個以上を受理していた。isValidRuleIcon 共有で表現方式ごと統一。
	icon: v.pipe(
		v.string(),
		v.minLength(1, 'icon は必須です'),
		v.check(isValidRuleIcon, 'icon は 1〜2 個の絵文字で指定してください'),
	),
	pointCost: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(RULE_POINT_MIN, `pointCost は ${RULE_POINT_MIN} 以上で指定してください`),
			v.maxValue(RULE_POINT_MAX, `pointCost は ${RULE_POINT_MAX} 以下で指定してください`),
		),
	),
	pointBonus: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(RULE_POINT_MIN, `pointBonus は ${RULE_POINT_MIN} 以上で指定してください`),
			v.maxValue(RULE_POINT_MAX, `pointBonus は ${RULE_POINT_MAX} 以下で指定してください`),
		),
	),
});

export const RulePresetPayloadSchema = v.object({
	ruleType: v.picklist(RULE_TYPES, 'ruleType は RULE_TYPES のいずれかで指定してください'),
	rules: v.pipe(v.array(RulePresetItemSchema), v.minLength(1, 'rules は 1 件以上含めてください')),
});

export type RulePresetItem = v.InferOutput<typeof RulePresetItemSchema>;
export type RulePresetPayload = v.InferOutput<typeof RulePresetPayloadSchema>;
