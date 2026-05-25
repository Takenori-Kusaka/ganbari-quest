/**
 * challenge-set MarketplaceTypeDescriptor 登録 — ADR-0052 (Issue #2369、EPIC #2362 P3)
 *
 * `MarketplaceTypeRegistry` への challenge-set 登録 SSOT。
 * `src/lib/marketplace/index.ts` の side-effect eager-load (`import './types/challenge-set'`)
 * 経由で起動時に 1 度だけ実行される。
 *
 * 設計原則 (ADR-0052 §2.4):
 *   - 1 type = 1 module。本 module の責務は Descriptor 組み立て + register() のみ
 *   - Strategy 実装は `../strategies/challenge-set-strategy.ts` に分離
 *   - Schema は `../schemas/challenge-set-schema.ts` に分離 (#2364)
 *
 * #2369 EPIC #2362 P3 / EPIC #2294 案 B-γ 整合:
 *   - `requiresChildId: false` — challenge-set は per-child instance を複数生成するため
 *     単一 childId は不要 (代わりに `requiresChildSelection: true` で childIds 配列を取得)
 *
 * #2362 PR-7 (ADR-0055、User §6):
 *   - `requiresChildSelection: true` — per-child instance 化に伴い、取込時に
 *     ChildSelectionDialog で対象 child を選択 (複数選択 / 全員選択可) する
 *
 * 関連:
 *   - $lib/marketplace/registry (singleton marketplaceRegistry)
 *   - $lib/marketplace/strategies/challenge-set-strategy
 *   - $lib/marketplace/schemas/challenge-set-schema
 */

import { marketplaceRegistry } from '$lib/marketplace/registry.js';
import type { ChallengeSetPayload } from '$lib/marketplace/schemas/challenge-set-schema.js';
import { ChallengeSetPayloadSchema } from '$lib/marketplace/schemas/challenge-set-schema.js';
import { challengeSetStrategy } from '$lib/marketplace/strategies/challenge-set-strategy.js';
import type { MarketplaceTypeDescriptor } from '$lib/marketplace/types.js';

/** challenge-set Descriptor (Registry に登録される本体) */
export const challengeSetDescriptor: MarketplaceTypeDescriptor<
	'challenge-set',
	ChallengeSetPayload
> = {
	typeCode: 'challenge-set',
	displayLabel: 'チャレンジ集',
	description:
		'マーケットプレイス公式のチャレンジ集 (例: 日本年間行事パック)。家族で取り組む協力チャレンジを一括追加します。',
	strategy: challengeSetStrategy,
	requiresChildId: false,
	// #2362 PR-7 (ADR-0055、User §6): per-child instance 化に伴い、取込時に
	// ChildSelectionDialog で対象 child を選択する (複数選択 / 全員選択可)。
	// Strategy 実装は ctx.childIds の各 child に per-child instance を作成する。
	requiresChildSelection: true,
	schema: ChallengeSetPayloadSchema,
};

// side-effect: 起動時 1 度だけ Registry に登録
marketplaceRegistry.register(challengeSetDescriptor);
