/**
 * Marketplace `rule-preset` payload schema (Valibot).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type schema SSOT.
 *
 * 既存 SSOT: src/lib/domain/marketplace-item.ts `RulePresetPayload`
 */

import * as v from 'valibot';

/** ルールタイプ */
export const RULE_TYPES = ['exchange', 'bonus', 'penalty', 'special'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/** rule-preset item: 単一のルール (`RulePresetPayload['rules'][number]` の rebuild) */
export const RulePresetItemSchema = v.object({
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
	// icon は単一の emoji を想定 (ZWJ 連結 emoji 例: 👨‍👩‍👧‍👦 = 11 UTF-16 code units)
	// を許容するため maxLength=20 (ZWJ profession sequences は ~17 で安全圏)
	icon: v.pipe(v.string(), v.minLength(1, 'icon は必須です'), v.maxLength(20)),
	pointCost: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(0, 'pointCost は 0 以上で指定してください'),
			v.maxValue(10000),
		),
	),
	pointBonus: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(0, 'pointBonus は 0 以上で指定してください'),
			v.maxValue(10000),
		),
	),
});

export const RulePresetPayloadSchema = v.object({
	ruleType: v.picklist(RULE_TYPES, 'ruleType は RULE_TYPES のいずれかで指定してください'),
	rules: v.pipe(v.array(RulePresetItemSchema), v.minLength(1, 'rules は 1 件以上含めてください')),
});

export type RulePresetItem = v.InferOutput<typeof RulePresetItemSchema>;
export type RulePresetPayload = v.InferOutput<typeof RulePresetPayloadSchema>;
