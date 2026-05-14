/**
 * Svelte 5 Context DI ヘルパー — ADR-0046 (Issue #2069)
 *
 * `ChildDashboardService` を `+layout.svelte` で注入し、配下の
 * コンポーネントが `getDashboardService()` で取得する仕組み。
 *
 * 実装方針:
 *   - Svelte 5 の `createContext` は 5.40+ で stable だが、現時点の依存
 *     範囲（typing の安定性 / E2E 既存通過の保護）を優先し、
 *     旧来の `setContext` / `getContext` + symbol キー パターンを採用。
 *   - 型は `ChildDashboardService` で強制し、interface を満たさない注入を
 *     コンパイル時に弾く。
 *
 * 使用例:
 *
 * ```svelte
 * // +layout.svelte (production)
 * <script lang="ts">
 *   import { setDashboardService } from '$lib/services/context';
 *   import { createProductionDashboardService } from '$lib/services/production/DashboardService';
 *   const { data, children } = $props();
 *   setDashboardService(createProductionDashboardService(data.homeData));
 * </script>
 * {@render children?.()}
 * ```
 *
 * ```svelte
 * // 配下コンポーネント
 * <script lang="ts">
 *   import { getDashboardService } from '$lib/services/context';
 *   const service = getDashboardService();
 *   const home = service.getHomeData();
 * </script>
 * ```
 */

import { getContext, setContext } from 'svelte';
import type { ChildDashboardService } from './types';

/** Context キー (collision 回避のため symbol を使用) */
const DASHBOARD_SERVICE_KEY = Symbol('gq:child-dashboard-service');

/**
 * 親コンポーネント (`+layout.svelte` 等) で 1 度だけ呼び出す。
 * `setContext` の制約上、コンポーネント初期化中にのみ呼べる。
 */
export function setDashboardService(service: ChildDashboardService): void {
	setContext(DASHBOARD_SERVICE_KEY, service);
}

/**
 * 配下コンポーネントから取得する。
 *
 * 注入されていない場合は明示的に throw する。silent fallback すると
 * 「本番 / demo どちらの service が動いているか分からない」状態を
 * 招き、ADR-0046 の SSOT 原則を破壊するため。
 */
export function getDashboardService(): ChildDashboardService {
	const service = getContext<ChildDashboardService | undefined>(DASHBOARD_SERVICE_KEY);
	if (!service) {
		throw new Error(
			'[gq:context] ChildDashboardService not found. ' +
				'Call setDashboardService() in a parent +layout.svelte before using getDashboardService().',
		);
	}
	return service;
}

/**
 * 注入有無の判定（テスト / 段階移行用）。本番コードの分岐には使わない。
 */
export function hasDashboardService(): boolean {
	return getContext<ChildDashboardService | undefined>(DASHBOARD_SERVICE_KEY) !== undefined;
}
