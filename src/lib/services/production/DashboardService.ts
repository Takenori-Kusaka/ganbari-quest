/**
 * ProductionDashboardService — ADR-0046 (Issue #2069)
 *
 * 本番 (Cognito 認証 + Drizzle ORM 経由) の ChildDashboardService 実装。
 *
 * POC scope:
 *   - SvelteKit の SSR load 関数 (`+layout.server.ts` / `+page.server.ts`) が
 *     既存通り DB から組み立てたデータを **そのまま受け取り**、
 *     UI コンポーネントへの「窓口」として interface 形式で提示する。
 *   - DB アクセスや認証 (`requireTenantId`) は既存の +page.server.ts に残し、
 *     POC 段階では本 service は組み立て済みデータの保持に専念する
 *     (= 既存挙動を保証し、UI 等価性を担保する)。
 *
 * Reactive 設計:
 *   - SvelteKit の `data` (PageData) は navigation 時に再生成されるため、
 *     service は **「getter 関数」を保持し、呼び出しのたびに最新値を返す**
 *     形にしている。これにより Svelte 5 の `state_referenced_locally` 警告を
 *     回避し、layout 再描画時の data 変化に追従できる。
 *
 * follow-up scope (Issue #2069 残り):
 *   - completeTask / claimLoginBonus 等の write 動詞を追加し、SvelteKit form
 *     action 経由の動線も interface 経由に統一する
 *   - admin / activities / rewards 等の他ページを同 interface 系統に拡張
 */

import type { ChildDashboardHomeData, ChildDashboardService } from '../types';

export class ProductionDashboardService implements ChildDashboardService {
	readonly kind = 'production' as const;

	readonly #getHomeData: () => ChildDashboardHomeData;

	constructor(getHomeData: () => ChildDashboardHomeData) {
		this.#getHomeData = getHomeData;
	}

	getHomeData(): ChildDashboardHomeData {
		return this.#getHomeData();
	}
}

/**
 * Factory helper — `+layout.svelte` から
 * `setDashboardService(createProductionDashboardService(() => ({...data})))` の
 * 形で getter 関数を渡す。setContext は初期化時 1 回のみだが、getter は
 * 呼び出しのたびに最新の closure をたどるため reactive 値も追従できる。
 */
export function createProductionDashboardService(
	getHomeData: () => ChildDashboardHomeData,
): ProductionDashboardService {
	return new ProductionDashboardService(getHomeData);
}
