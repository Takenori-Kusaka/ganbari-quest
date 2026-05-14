/**
 * Service Interface 定義 — ADR-0046 (Issue #2069 + #2085 follow-up)
 *
 * 本番 (Cognito + Drizzle) / demo (sessionStorage + $state) の両実装が
 * 満たすべき契約をここに集約する。UI コンポーネント (DashboardView 等) は
 * このインターフェース越しにのみサービスを参照する。
 *
 * POC scope (Issue #2069 / PR #2079):
 *   - ChildDashboardService の read-only 観点 (getHomeData)
 *
 * 拡張 scope (Issue #2085):
 *   - write 観点 (recordActivity / cancelRecord / claimLoginBonus /
 *     toggleActivityPin) を interface に追加
 *   - 本番側: 既存 REST `/api/v1/...` 経路を fetch で呼ぶ (server-side
 *     services と二重実装しない、DRY)
 *   - demo 側: sessionStorage に in-memory state を書き戻し、ページ再 load
 *     後も累積結果を保持できるようにする
 *   - 本 Issue では UI 配線 (DashboardView の form action 切替) は対象外
 *     (#2084 / 別 follow-up で扱う)
 *
 * 設計原則:
 *   - 本 interface は SSR / CSR 両環境で呼び出される可能性がある
 *   - DemoDashboardService は browser 専用処理 (sessionStorage) を持つが
 *     SSR 時は seed data を返すフォールバックを必須とする
 *   - 本番側はサーバ load の中で同期的に組み立てた結果を保持する
 *   - write API は **常に Promise を返す** (本番 fetch / demo 同期どちらも
 *     同じ呼出記法で扱えるように)
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
 * 活動記録 write API の input。
 *
 * - 本番: 内部で cookie `selectedChildId` を読むか、layout context 経由で
 *   解決した childId と組み合わせて REST `POST /api/v1/activity-logs` を呼ぶ。
 * - demo: `activityId` のみで in-memory state を更新する。
 */
export interface RecordActivityInput {
	activityId: number;
}

/**
 * 活動記録 write API の結果。
 *
 * - server-side `recordActivity()` (activity-log-service.ts) が返す
 *   `RecordActivityResult` のうち、UI 描画に直結するフィールドだけを抽出し
 *   demo / 本番の両側で揃えやすくしたサブセット。
 * - エラー時は discriminated union で表現 (`ok: false` + `error` code)。
 */
export type RecordActivityWriteResult =
	| {
			ok: true;
			logId: number;
			activityName: string;
			totalPoints: number;
			streakDays: number;
			streakBonus: number;
			cancelableUntil: string | null;
	  }
	| { ok: false; error: 'ALREADY_RECORDED' | 'DAILY_LIMIT_REACHED' | 'NOT_FOUND' | 'NETWORK' };

/**
 * 記録キャンセル write API の input / 結果。
 */
export interface CancelRecordInput {
	/** 取消したい activity_log の id (本番のみ必要。demo は最後の record をキャンセル) */
	logId: number;
}

export type CancelRecordResult =
	| { ok: true; refundedPoints: number }
	| { ok: false; error: 'NOT_FOUND' | 'CANCEL_EXPIRED' | 'NETWORK' };

/**
 * ログインボーナス受け取り API の結果。
 *
 * - 本番 `claimLoginBonus()` (login-bonus-service.ts) の戻り値と整合。
 */
export type ClaimLoginBonusResult =
	| {
			ok: true;
			rank: string;
			basePoints: number;
			multiplier: number;
			totalPoints: number;
			consecutiveLoginDays: number;
	  }
	| { ok: false; error: 'ALREADY_CLAIMED' | 'NOT_FOUND' | 'NETWORK' };

/**
 * 活動ピン留めトグル API の input / 結果。
 */
export interface ToggleActivityPinInput {
	activityId: number;
	pinned: boolean;
}

export type ToggleActivityPinResult =
	| { ok: true; isPinned: boolean }
	| { ok: false; error: 'NOT_FOUND' | 'LIMIT_EXCEEDED' | 'NETWORK' };

/**
 * Child Dashboard サービス契約。
 *
 * 本番 (ProductionDashboardService) と demo (DemoDashboardService) が
 * これを共通実装する。コンポーネントは `getDashboardService()` 経由で
 * インスタンスを取得し、どちらが注入されたかを意識しない。
 *
 * write API はいずれも `Promise` を返す。本番は network fetch 中、
 * demo は in-memory + sessionStorage 操作で同期的に完了するが、
 * 呼出側が分岐しないよう Promise でラップする。
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

	/**
	 * 活動を記録する。
	 *
	 * - production: REST `POST /api/v1/activity-logs` を呼ぶ
	 * - demo: `todayRecorded` を増分し sessionStorage に persist
	 */
	recordActivity(input: RecordActivityInput): Promise<RecordActivityWriteResult>;

	/**
	 * 記録を取消す。
	 *
	 * - production: REST `DELETE /api/v1/activity-logs/[id]` を呼ぶ
	 * - demo: 直近の record を sessionStorage から減算 (logId は無視可)
	 */
	cancelRecord(input: CancelRecordInput): Promise<CancelRecordResult>;

	/**
	 * ログインボーナスを受け取る。
	 *
	 * - production: REST `POST /api/v1/login-bonus/[childId]/claim` を呼ぶ
	 * - demo: 固定値を返し sessionStorage の lastClaimDate を記録
	 */
	claimLoginBonus(): Promise<ClaimLoginBonusResult>;

	/**
	 * 活動のピン留め状態を切替える。
	 *
	 * - production: REST `POST /api/v1/children/[id]/activities/[activityId]/pin` を呼ぶ
	 * - demo: in-memory map に保持
	 */
	toggleActivityPin(input: ToggleActivityPinInput): Promise<ToggleActivityPinResult>;
}
