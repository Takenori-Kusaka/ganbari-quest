/**
 * rule-preset MarketplaceTypeDescriptor 登録 — ADR-0052 (Issue #2368)
 *
 * `MarketplaceTypeRegistry` への rule-preset 登録 SSOT。
 * `src/lib/marketplace/index.ts` の side-effect eager-load (`import './types/rule-preset'`)
 * 経由で起動時に 1 度だけ実行される。
 *
 * 設計原則 (ADR-0052 §2.4):
 *   - 1 type = 1 module。本 module の責務は Descriptor 組み立て + register() のみ
 *   - Strategy 実装は `../strategies/rule-preset-strategy.ts` に分離 (sub-dispatcher)
 *   - 4 ruleType 個別実装は `../strategies/rule-preset/*.ts` に分離
 *   - Schema は `../schemas/rule-preset-schema.ts` (#2364)
 *
 * `requiresChildId`: false (exchange は childId 必須だが、bonus/penalty/special は不要なため
 * Registry レベルでは false。callsite で payload.ruleType を見て個別判定する)。
 *
 * 関連:
 *   - $lib/marketplace/registry (singleton marketplaceRegistry)
 *   - $lib/marketplace/strategies/rule-preset-strategy
 *   - $lib/marketplace/schemas/rule-preset-schema
 */

import { marketplaceRegistry } from '$lib/marketplace/registry.js';
import type { RulePresetPayload } from '$lib/marketplace/schemas/rule-preset-schema.js';
import { RulePresetPayloadSchema } from '$lib/marketplace/schemas/rule-preset-schema.js';
import { rulePresetStrategy } from '$lib/marketplace/strategies/rule-preset-strategy.js';
import type { MarketplaceTypeDescriptor } from '$lib/marketplace/types.js';

/** rule-preset Descriptor (Registry に登録される本体) */
export const rulePresetDescriptor: MarketplaceTypeDescriptor<'rule-preset', RulePresetPayload> = {
	typeCode: 'rule-preset',
	// #2899: MARKETPLACE_TYPE_LABELS['rule-preset'] (marketplace-item.ts) と一致させる
	// (DESIGN.md §6 marketplace type 命名規則「2 つの SSOT を一致させる」)。
	displayLabel: 'とくべつルール',
	description:
		'マーケットプレイス公式のとくべつルール (例: ポイント交換 / 連続ボーナス、4 ruleType 対応)',
	strategy: rulePresetStrategy,
	requiresChildId: false,
	schema: RulePresetPayloadSchema,
};

// side-effect: 起動時 1 度だけ Registry に登録
marketplaceRegistry.register(rulePresetDescriptor);
