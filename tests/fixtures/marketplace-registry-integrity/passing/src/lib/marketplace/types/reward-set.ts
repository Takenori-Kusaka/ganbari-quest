// @ts-nocheck — fixture file for scripts/check-marketplace-registry-integrity.mjs (#2389). 実 import 解決不要 (script は regex でファイル内容を検査するのみ)
import { marketplaceRegistry } from '../registry.js';
import { RewardSetPayloadSchema } from '../schemas/reward-set-schema.js';
import { rewardSetStrategy } from '../strategies/reward-set-strategy.js';

export const rewardSetDescriptor = {
	typeCode: 'reward-set',
	displayLabel: 'fixture-reward-set',
	description: 'fixture descriptor',
	strategy: rewardSetStrategy,
	requiresChildId: true,
	schema: RewardSetPayloadSchema,
};

marketplaceRegistry.register(rewardSetDescriptor);
