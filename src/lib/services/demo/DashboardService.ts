/**
 * DemoDashboardService — ADR-0046 (Issue #2069)
 *
 * 未認証 demo 画面用の ChildDashboardService 実装。
 *
 * 設計:
 *   - SSR 時はサーバ load (`/demo/(child)/[mode]/home/+page.server.ts`) が
 *     `getDemoHomeData()` (`$lib/server/demo/demo-service.ts`) でシード
 *     データを構築する。そのスナップショットを seed として保持。
 *   - クライアント (browser) ではタブ単位の `sessionStorage` から
 *     `record` 等の累積結果を復元できる構造を持つ。POC scope では
 *     read-only `getHomeData()` のみ実装し、write API は follow-up。
 *
 * Reactive 設計:
 *   - SvelteKit の `data` (PageData) は navigation 時に再生成されるため、
 *     コンストラクタは **「seed getter」関数を受け取り**、呼び出しの度に
 *     最新の closure 値を読む。これにより Svelte 5 の
 *     `state_referenced_locally` 警告を避け、layout 再 mount なしで
 *     mode 切替 (preschool ↔ elementary 等) にも追従できる。
 *
 * 注意:
 *   - sessionStorage は SSR では undefined。必ず `typeof window` で
 *     ガードする。SSR で誤って参照すると "window is not defined" で
 *     hydration が壊れる (Issue #2069 Things Not To Do)。
 *   - 現状 demo は単方向 (server load → 表示) のため sessionStorage
 *     書き戻しは行わない。POC 完了後の follow-up で write API を
 *     追加した際に hooks を足す。
 */

import type { ChildDashboardHomeData, ChildDashboardService } from '../types';

/** タブ単位の demo state 隔離キー */
const DEMO_STORAGE_KEY = 'gq:demo:child-dashboard-home-v1';

export class DemoDashboardService implements ChildDashboardService {
	readonly kind = 'demo' as const;

	readonly #getSeed: () => ChildDashboardHomeData;

	constructor(getSeed: () => ChildDashboardHomeData) {
		this.#getSeed = getSeed;
	}

	getHomeData(): ChildDashboardHomeData {
		const seed = this.#getSeed();

		// SSR 環境: sessionStorage は未定義。seed をそのまま返す。
		if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
			return seed;
		}

		// CSR 環境: sessionStorage から restore を試みる。
		// 失敗 (JSON 壊れ / schema 変更等) しても silently seed に fallback する
		// — demo は user 価値が最優先で「動かなくなる」事故を最小化する。
		try {
			const raw = sessionStorage.getItem(DEMO_STORAGE_KEY);
			if (!raw) return seed;
			const restored = JSON.parse(raw) as ChildDashboardHomeData;
			// 最低限の sanity check — child / todayRecorded / pointSettings の存在のみ
			if (
				!restored ||
				typeof restored !== 'object' ||
				!Array.isArray((restored as { todayRecorded?: unknown }).todayRecorded) ||
				!(restored as { pointSettings?: unknown }).pointSettings
			) {
				return seed;
			}
			return restored;
		} catch {
			return seed;
		}
	}
}

/**
 * Factory helper — `/demo/(child)/+layout.svelte` 等から
 * `setDashboardService(createDemoDashboardService(() => ({ ...data })))` の
 * 形で getter 関数を渡す。
 *
 * SSR 安全: seed は server load 由来の値で、browser でしか sessionStorage
 * 復元処理を行わない。
 */
export function createDemoDashboardService(
	getSeed: () => ChildDashboardHomeData,
): DemoDashboardService {
	return new DemoDashboardService(getSeed);
}

/** Demo state を sessionStorage に保存する (follow-up write API 用 helper、現状未使用) */
export function persistDemoHomeData(data: ChildDashboardHomeData): void {
	if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
	} catch {
		// QuotaExceeded / private mode 等は黙って諦める (demo は best-effort)
	}
}

/** Demo state を sessionStorage からクリアする (テスト / リセットボタン用) */
export function clearDemoHomeData(): void {
	if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.removeItem(DEMO_STORAGE_KEY);
	} catch {
		// ignore
	}
}
