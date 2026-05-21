// @ts-nocheck — fixture file for scripts/check-marketplace-registry-integrity.mjs (#2389). 実 import 解決不要 (script は regex でファイル内容を検査するのみ)
import { marketplaceRegistry } from '../registry.js';
import { RulePresetPayloadSchema } from '../schemas/rule-preset-schema.js';
import { rulePresetStrategy } from '../strategies/rule-preset-strategy.js';

export const rulePresetDescriptor = {
	typeCode: 'rule-preset',
	displayLabel: 'fixture-rule-preset',
	description: 'fixture descriptor',
	strategy: rulePresetStrategy,
	requiresChildId: false,
	schema: RulePresetPayloadSchema,
};

marketplaceRegistry.register(rulePresetDescriptor);
