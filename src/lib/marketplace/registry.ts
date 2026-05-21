/**
 * MarketplaceTypeRegistry — ADR-0052 (Issue #2363)
 *
 * 5 種類の MarketplaceItemType (activity-pack / reward-set / checklist /
 * rule-preset / challenge-set) の Descriptor を一元管理する Registry。
 *
 * 設計原則 (ADR-0052):
 *   - VSCode `contributes` / Obsidian Plugin / Figma Manifest と同型の
 *     register/get/list interface
 *   - 未登録 type の get() は明確な error で fail-fast (silent fallback 禁止)
 *   - TypeScript discriminated union により `get('activity-pack')` 型安全
 *   - eager-load パターン: `src/lib/marketplace/index.ts` で
 *     `import './types/<type>'` の side-effect により全 type が起動時登録
 *
 * 関連:
 *   - ADR-0046 (Service Interface + Context DI) — 配布は context.ts へ
 *   - ADR-0014 / #1350 (OSS 先調査) — Strategy + Registry 採用根拠
 */

import type {
	AnyMarketplaceTypeDescriptor,
	MarketplaceTypeCode,
	MarketplaceTypeDescriptor,
} from './types.js';
import { MARKETPLACE_TYPE_CODES } from './types.js';

/**
 * MarketplaceTypeDescriptor を一元管理する Registry。
 *
 * 使用例:
 *
 * ```ts
 * import { MarketplaceTypeRegistry } from '$lib/marketplace/registry';
 * import { activityPackDescriptor } from '$lib/marketplace/types/activity-pack'; // #2365
 *
 * const registry = new MarketplaceTypeRegistry();
 * registry.register(activityPackDescriptor);
 *
 * const desc = registry.get('activity-pack'); // 型安全
 * await desc.strategy.apply(payload, { tenantId: 't1' });
 * ```
 */
export class MarketplaceTypeRegistry {
	#descriptors = new Map<MarketplaceTypeCode, AnyMarketplaceTypeDescriptor>();

	/**
	 * Descriptor を登録する。同一 typeCode の二重登録は明確な error で fail-fast。
	 *
	 * @throws Error 既に同 typeCode が登録済みの場合
	 */
	register<TCode extends MarketplaceTypeCode, TPayload>(
		descriptor: MarketplaceTypeDescriptor<TCode, TPayload>,
	): void {
		if (this.#descriptors.has(descriptor.typeCode)) {
			throw new Error(
				`[MarketplaceTypeRegistry] type "${descriptor.typeCode}" is already registered. ` +
					`Duplicate registration is forbidden — check for accidental double-import in ` +
					`src/lib/marketplace/index.ts.`,
			);
		}
		this.#descriptors.set(
			descriptor.typeCode,
			descriptor as unknown as AnyMarketplaceTypeDescriptor,
		);
	}

	/**
	 * 指定 typeCode の Descriptor を返す。未登録の場合は明確な error で throw。
	 *
	 * TypeScript discriminated union により、リテラル型コードを渡せば
	 * 戻り値の型が `MarketplaceTypeDescriptor<'activity-pack', ...>` に narrow される。
	 *
	 * @throws Error 未登録 typeCode が渡された場合
	 */
	get<TCode extends MarketplaceTypeCode>(
		typeCode: TCode,
	): MarketplaceTypeDescriptor<TCode, unknown> {
		const descriptor = this.#descriptors.get(typeCode);
		if (!descriptor) {
			const registered = Array.from(this.#descriptors.keys()).join(', ') || '(none)';
			throw new Error(
				`[MarketplaceTypeRegistry] type "${typeCode}" is not registered. ` +
					`Registered types: ${registered}. ` +
					`Ensure src/lib/marketplace/index.ts imports the corresponding type module.`,
			);
		}
		return descriptor as unknown as MarketplaceTypeDescriptor<TCode, unknown>;
	}

	/**
	 * 指定 typeCode が登録済みか判定する。
	 * 本番コードの分岐に乱用しない (Registry の責務は SSOT、`if (has)` 散在禁止)。
	 */
	has(typeCode: MarketplaceTypeCode): boolean {
		return this.#descriptors.has(typeCode);
	}

	/**
	 * 登録済み Descriptor の全件を返す。
	 * 親管理画面の type 選択 UI などで全件列挙する用途。
	 *
	 * 順序は MARKETPLACE_TYPE_CODES の順 (UI 表示順を安定化)。
	 */
	list(): AnyMarketplaceTypeDescriptor[] {
		return MARKETPLACE_TYPE_CODES.filter((code) => this.#descriptors.has(code)).map(
			(code) => this.#descriptors.get(code) as AnyMarketplaceTypeDescriptor,
		);
	}

	/** 登録済み件数。テスト / 監視用。 */
	size(): number {
		return this.#descriptors.size;
	}

	/**
	 * 全 Descriptor を破棄する。テスト用途のみ。
	 * 本番コードからの呼び出し禁止。
	 */
	clear(): void {
		this.#descriptors.clear();
	}
}

/**
 * Process 全体で共有する singleton Registry。
 *
 * 通常は `src/lib/marketplace/index.ts` の eager-load で全 type が登録される。
 * SSR と CSR で同じ参照を共有 (module scope) し、ADR-0046 Context DI で配布される。
 */
export const marketplaceRegistry = new MarketplaceTypeRegistry();
