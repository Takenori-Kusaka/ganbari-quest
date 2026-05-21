// @ts-nocheck — fixture file for scripts/check-marketplace-registry-integrity.mjs (#2389). 実 import 解決不要 (script は regex でファイル内容を検査するのみ)
import { marketplaceRegistry } from '../registry.js';
import { ChallengeSetPayloadSchema } from '../schemas/challenge-set-schema.js';
import { challengeSetStrategy } from '../strategies/challenge-set-strategy.js';

export const challengeSetDescriptor = {
	typeCode: 'challenge-set',
	displayLabel: 'fixture-challenge-set',
	description: 'fixture descriptor',
	strategy: challengeSetStrategy,
	requiresChildId: true,
	schema: ChallengeSetPayloadSchema,
};

marketplaceRegistry.register(challengeSetDescriptor);
