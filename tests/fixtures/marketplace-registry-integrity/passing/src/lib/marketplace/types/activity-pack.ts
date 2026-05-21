// @ts-nocheck — fixture file for scripts/check-marketplace-registry-integrity.mjs (#2389). 実 import 解決不要 (script は regex でファイル内容を検査するのみ)
import { marketplaceRegistry } from '../registry.js';
import { ActivityPackPayloadSchema } from '../schemas/activity-pack-schema.js';
import { activityPackStrategy } from '../strategies/activity-pack-strategy.js';

export const activityPackDescriptor = {
	typeCode: 'activity-pack',
	displayLabel: 'fixture-activity-pack',
	description: 'fixture descriptor',
	strategy: activityPackStrategy,
	requiresChildId: false,
	schema: ActivityPackPayloadSchema,
};

marketplaceRegistry.register(activityPackDescriptor);
