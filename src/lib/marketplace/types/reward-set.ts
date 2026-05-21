/**
 * reward-set MarketplaceTypeDescriptor 登録 — ADR-0052 (Issue #2366)
 *
 * `MarketplaceTypeRegistry` への reward-set 登録 SSOT。
 * `src/lib/marketplace/index.ts` の side-effect eager-load (`import './types/reward-set'`)
 * 経由で起動時に 1 度だけ実行される。
 *
 * 設計原則 (ADR-0052 §2.4):
 *   - 1 type = 1 module。本 module の責務は Descriptor 組み立て + register() のみ
 *   - Strategy 実装は `../strategies/reward-set-strategy.ts` に分離
 *   - Schema は `../schemas/reward-set-schema.ts` に分離 (#2364)
 *   - **requiresChildId = true**: reward-set は子供毎に紐付くため import 時に childId 必須
 *
 * 関連:
 *   - $lib/marketplace/registry (singleton marketplaceRegistry)
 *   - $lib/marketplace/strategies/reward-set-strategy
 *   - $lib/marketplace/schemas/reward-set-schema
 */

import { marketplaceRegistry } from '$lib/marketplace/registry.js';
import type { RewardSetPayload } from '$lib/marketplace/schemas/reward-set-schema.js';
import { RewardSetPayloadSchema } from '$lib/marketplace/schemas/reward-set-schema.js';
import { rewardSetStrategy } from '$lib/marketplace/strategies/reward-set-strategy.js';
import type { MarketplaceTypeDescriptor } from '$lib/marketplace/types.js';

/** reward-set Descriptor (Registry に登録される本体) */
export const rewardSetDescriptor: MarketplaceTypeDescriptor<'reward-set', RewardSetPayload> = {
	typeCode: 'reward-set',
	displayLabel: 'ごほうびセット',
	description: 'マーケットプレイス公式のごほうびセット (例: ようじごほうび)',
	strategy: rewardSetStrategy,
	requiresChildId: true,
	schema: RewardSetPayloadSchema,
};

// side-effect: 起動時 1 度だけ Registry に登録
marketplaceRegistry.register(rewardSetDescriptor);
