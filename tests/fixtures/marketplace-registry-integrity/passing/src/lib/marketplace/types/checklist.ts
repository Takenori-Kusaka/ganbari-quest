// @ts-nocheck — fixture file for scripts/check-marketplace-registry-integrity.mjs (#2389). 実 import 解決不要 (script は regex でファイル内容を検査するのみ)
import { marketplaceRegistry } from '../registry.js';
import { ChecklistPayloadSchema } from '../schemas/checklist-schema.js';
import { checklistStrategy } from '../strategies/checklist-strategy.js';

export const checklistDescriptor = {
	typeCode: 'checklist',
	displayLabel: 'fixture-checklist',
	description: 'fixture descriptor',
	strategy: checklistStrategy,
	requiresChildId: false,
	schema: ChecklistPayloadSchema,
};

marketplaceRegistry.register(checklistDescriptor);
