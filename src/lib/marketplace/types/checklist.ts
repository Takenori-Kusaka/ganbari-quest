/**
 * checklist MarketplaceTypeDescriptor 登録 — ADR-0052 (Issue #2367)
 *
 * `MarketplaceTypeRegistry` への checklist 登録 SSOT。
 * `src/lib/marketplace/index.ts` の side-effect eager-load (`import './types/checklist'`)
 * 経由で起動時に 1 度だけ実行される。
 *
 * 設計原則 (ADR-0052 §2.4):
 *   - 1 type = 1 module。本 module の責務は Descriptor 組み立て + register() のみ
 *   - Strategy 実装は `../strategies/checklist-strategy.ts` に分離
 *   - Schema は `../schemas/checklist-schema.ts` に分離 (#2364)
 *
 * 関連:
 *   - $lib/marketplace/registry (singleton marketplaceRegistry)
 *   - $lib/marketplace/strategies/checklist-strategy
 *   - $lib/marketplace/schemas/checklist-schema
 */

import { marketplaceRegistry } from '$lib/marketplace/registry.js';
import type { ChecklistPayload } from '$lib/marketplace/schemas/checklist-schema.js';
import { ChecklistPayloadSchema } from '$lib/marketplace/schemas/checklist-schema.js';
import { checklistStrategy } from '$lib/marketplace/strategies/checklist-strategy.js';
import type { MarketplaceTypeDescriptor } from '$lib/marketplace/types.js';

/** checklist Descriptor (Registry に登録される本体) */
export const checklistDescriptor: MarketplaceTypeDescriptor<'checklist', ChecklistPayload> = {
	typeCode: 'checklist',
	displayLabel: 'チェックリスト',
	description: 'マーケットプレイス公式の持ち物チェックリスト (例: プールの もちもの)',
	strategy: checklistStrategy,
	requiresChildId: true,
	schema: ChecklistPayloadSchema,
};

// side-effect: 起動時 1 度だけ Registry に登録
marketplaceRegistry.register(checklistDescriptor);
