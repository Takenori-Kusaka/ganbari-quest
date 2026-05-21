/**
 * Marketplace schemas SSOT (Valibot + Standard Schema spec).
 *
 * Issue #2364 (EPIC #2362 P1): MarketplacePayloadMap 5 type の schema を一元 export する。
 *
 * 設計原則 (ADR-0045 type-extended pattern):
 *  - 各 type 個別ファイル (atom) で Valibot schema を定義
 *  - 本 index (compound) で `MarketplacePayloadSchemaMap` として再 export
 *  - Standard Schema spec 経由で将来 Zod/ArkType 切替を可能に保つ
 *
 * 使用例:
 * ```ts
 * import * as v from 'valibot';
 * import { ActivityPackPayloadSchema, type ActivityPackPayload } from '$lib/marketplace/schemas';
 *
 * const result = v.safeParse(ActivityPackPayloadSchema, unknownInput);
 * if (result.success) {
 *   const payload: ActivityPackPayload = result.output;
 * }
 * ```
 */

// biome-ignore lint/performance/noBarrelFile: 5 type schema を一元参照する compound SSOT (ADR-0045 同型責務分離)。Registry (#2363) から参照される単一エントリポイントとして必要。
export {
	type ActivityPackItem,
	ActivityPackItemSchema,
	type ActivityPackPayload,
	ActivityPackPayloadSchema,
} from './activity-pack-schema.js';
export {
	type ChallengeSetItem,
	ChallengeSetItemSchema,
	type ChallengeSetPayload,
	ChallengeSetPayloadSchema,
} from './challenge-set-schema.js';

export {
	CHECKLIST_TIMINGS,
	type ChecklistItem,
	ChecklistItemSchema,
	type ChecklistPayload,
	ChecklistPayloadSchema,
	type ChecklistTiming,
} from './checklist-schema.js';
export {
	type RewardSetItem,
	RewardSetItemSchema,
	type RewardSetPayload,
	RewardSetPayloadSchema,
} from './reward-set-schema.js';
export {
	RULE_TYPES,
	type RulePresetItem,
	RulePresetItemSchema,
	type RulePresetPayload,
	RulePresetPayloadSchema,
	type RuleType,
} from './rule-preset-schema.js';

import { ActivityPackPayloadSchema } from './activity-pack-schema.js';
import { ChallengeSetPayloadSchema } from './challenge-set-schema.js';
import { ChecklistPayloadSchema } from './checklist-schema.js';
import { RewardSetPayloadSchema } from './reward-set-schema.js';
import { RulePresetPayloadSchema } from './rule-preset-schema.js';

/**
 * 5 type の payload schema を Marketplace type id でマッピングした SSOT。
 *
 * `MarketplaceTypeRegistry` (#2363 で起票) が type 別 strategy を解決する際に参照する想定。
 *
 * 注: `src/lib/domain/marketplace-item.ts` の `MarketplaceItemType` には #2297 で既に
 * `challenge-set` を含む 5 type 全てが定義済み (`'activity-pack' | 'reward-set' | 'checklist'
 * | 'rule-preset' | 'challenge-set'`)。本 schema 群は当該 interface 群と完全一致させる SSOT
 * 整合 schema として機能する。実 import service の challenge-set 対応は #2369 (EPIC P3 #7) で実装。
 */
export const MarketplacePayloadSchemaMap = {
	'activity-pack': ActivityPackPayloadSchema,
	'reward-set': RewardSetPayloadSchema,
	checklist: ChecklistPayloadSchema,
	'rule-preset': RulePresetPayloadSchema,
	'challenge-set': ChallengeSetPayloadSchema,
} as const;

export type MarketplacePayloadSchemaMap = typeof MarketplacePayloadSchemaMap;
export type MarketplaceTypeId = keyof MarketplacePayloadSchemaMap;
