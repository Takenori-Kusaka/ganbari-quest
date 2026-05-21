/**
 * activity-pack MarketplaceTypeDescriptor 登録 — ADR-0052 (Issue #2365)
 *
 * `MarketplaceTypeRegistry` への activity-pack 登録 SSOT。
 * `src/lib/marketplace/index.ts` の side-effect eager-load (`import './types/activity-pack'`)
 * 経由で起動時に 1 度だけ実行される。
 *
 * 設計原則 (ADR-0052 §2.4):
 *   - 1 type = 1 module。本 module の責務は Descriptor 組み立て + register() のみ
 *   - Strategy 実装は `../strategies/activity-pack-strategy.ts` に分離
 *   - Schema は `../schemas/activity-pack-schema.ts` に分離 (#2364)
 *
 * 関連:
 *   - $lib/marketplace/registry (singleton marketplaceRegistry)
 *   - $lib/marketplace/strategies/activity-pack-strategy
 *   - $lib/marketplace/schemas/activity-pack-schema
 */

import { marketplaceRegistry } from '$lib/marketplace/registry.js';
import type { ActivityPackPayload } from '$lib/marketplace/schemas/activity-pack-schema.js';
import { ActivityPackPayloadSchema } from '$lib/marketplace/schemas/activity-pack-schema.js';
import { activityPackStrategy } from '$lib/marketplace/strategies/activity-pack-strategy.js';
import type { MarketplaceTypeDescriptor } from '$lib/marketplace/types.js';

/** activity-pack Descriptor (Registry に登録される本体) */
export const activityPackDescriptor: MarketplaceTypeDescriptor<
	'activity-pack',
	ActivityPackPayload
> = {
	typeCode: 'activity-pack',
	displayLabel: '活動セット',
	description: 'マーケットプレイス公式の活動セット (例: 入園 1 週間スターター)',
	strategy: activityPackStrategy,
	requiresChildId: false,
	schema: ActivityPackPayloadSchema,
};

// side-effect: 起動時 1 度だけ Registry に登録
marketplaceRegistry.register(activityPackDescriptor);
