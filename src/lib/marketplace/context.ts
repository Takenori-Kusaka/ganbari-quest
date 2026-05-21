/**
 * MarketplaceTypeRegistry の Svelte 5 Context DI ヘルパー — ADR-0052 (Issue #2363)
 *
 * ADR-0046 同型の `setContext` / `getContext` + symbol キー パターンで
 * 配下コンポーネントに Registry を配布する。
 *
 * 使用例:
 *
 * ```svelte
 * // +layout.svelte (admin)
 * <script lang="ts">
 *   import { setMarketplaceRegistryContext } from '$lib/marketplace/context';
 *   import { marketplaceRegistry } from '$lib/marketplace/registry';
 *   setMarketplaceRegistryContext(marketplaceRegistry);
 * </script>
 * ```
 *
 * ```svelte
 * // 配下コンポーネント (UnifiedImportHub 等)
 * <script lang="ts">
 *   import { getMarketplaceRegistry } from '$lib/marketplace/context';
 *   const registry = getMarketplaceRegistry();
 *   const types = registry.list();
 * </script>
 * ```
 */

import { getContext, setContext } from 'svelte';
import type { MarketplaceTypeRegistry } from './registry.js';

/** Context キー (collision 回避のため symbol を使用) */
const MARKETPLACE_REGISTRY_KEY = Symbol('gq:marketplace-registry');

/**
 * 親コンポーネント (`+layout.svelte` 等) で 1 度だけ呼び出す。
 * `setContext` の制約上、コンポーネント初期化中にのみ呼べる。
 */
export function setMarketplaceRegistryContext(registry: MarketplaceTypeRegistry): void {
	setContext(MARKETPLACE_REGISTRY_KEY, registry);
}

/**
 * 配下コンポーネントから取得する。
 *
 * 注入されていない場合は明示的に throw する。silent fallback すると
 * SSR / CSR どちらの Registry が動いているか分からない状態を招き、
 * ADR-0046 の SSOT 原則を破壊するため。
 */
export function getMarketplaceRegistry(): MarketplaceTypeRegistry {
	const registry = getContext<MarketplaceTypeRegistry | undefined>(MARKETPLACE_REGISTRY_KEY);
	if (!registry) {
		throw new Error(
			'[gq:marketplace-context] MarketplaceTypeRegistry not found. ' +
				'Call setMarketplaceRegistryContext() in a parent +layout.svelte before using getMarketplaceRegistry().',
		);
	}
	return registry;
}

/**
 * 注入有無の判定 (テスト / 段階移行用)。本番コードの分岐には使わない。
 */
export function hasMarketplaceRegistry(): boolean {
	return getContext<MarketplaceTypeRegistry | undefined>(MARKETPLACE_REGISTRY_KEY) !== undefined;
}
