/**
 * Service Interface 定義 — ADR-0046 (Issue #2069)
 *
 * 本番 (Cognito + Drizzle) / demo (sessionStorage + $state) の両実装が
 * 満たすべき契約をここに集約する。UI コンポーネント (DashboardView 等) は
 * このインターフェース越しにのみサービスを参照する。
 *
 * POC scope (Issue #2069):
 *   - ChildDashboardService の read-only 観点 (getHomeData / getStatus)
 *   - write 観点 (completeTask 等) は SvelteKit form action の責務を保つため
 *     本 PR では interface に含めない。follow-up で段階的に拡張する。
 *
 * 設計原則:
 *   - 本 interface は SSR / CSR 両環境で呼び出される可能性がある
 *   - DemoDashboardService は browser 専用処理 (sessionStorage) を持つが
 *     SSR 時は seed data を返すフォールバックを必須とする
 *   - 本番側はサーバ load の中で同期的に組み立てた結果を保持する
 */

import type { PointSettings } from '$lib/domain/point-display';
import type { Child } from '$lib/server/db/types/index.js';

/**
 * Child Home (child dashboard) で必要となる最小限のデータ束。
 *
 * - 既存の本番 `+page.server.ts` / demo `getDemoHomeData()` が返す
 *   ペイロードのうち、UI 表示に直結する core slice のみを定義する。
 * - 拡張フィールド (活動チャレンジ / 兄弟ランキング等) は POC scope 外。
 */
export interface ChildDashboardHomeData {
	/** 表示中の子供 (null = 未選択 / 親アカウント直下) */
	child: Child | null;
	/** 今日記録した活動の件数マップ */
	todayRecorded: { activityId: number; count: number }[];
	/** ポイント表示設定 (通貨換算 / 単位等) */
	pointSettings: PointSettings;
}

/**
 * Child Dashboard サービス契約。
 *
 * 本番 (ProductionDashboardService) と demo (DemoDashboardService) が
 * これを共通実装する。コンポーネントは `getDashboardService()` 経由で
 * インスタンスを取得し、どちらが注入されたかを意識しない。
 */
export interface ChildDashboardService {
	/** サービス実装の種類を識別 (UI 側で「デモ表示」分岐を作る最小手段) */
	readonly kind: 'production' | 'demo';

	/**
	 * 現在表示すべき home data を返す。
	 *
	 * - production: `+page.server.ts` の load 結果から組み立て済みのスナップショット
	 * - demo: sessionStorage に保存された state があれば復元、なければ seed
	 */
	getHomeData(): ChildDashboardHomeData;
}
