/**
 * Service Interface 定義 — ADR-0046 (Issue #2069 + #2085 follow-up)
 *
 * 本番 (Cognito + Drizzle) / demo (sessionStorage + $state) の両実装が
 * 満たすべき契約をここに集約する。UI コンポーネント (ProdDashboardSections 等) は
 * このインターフェース越しにのみサービスを参照する。
 *
 * #2097 PR-B2 (#2187): demo POC で使われていた `DashboardView.svelte` は撤廃済。
 * UI 系統は `ProdDashboardSections.svelte` (本番) 単独構成となり、demo Lambda は
 * 本番 routes (`/<uiMode>/home` 等) を AnonymousAuth + DATA_SOURCE=demo で経由する。
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
 *   - 本 Issue では UI 配線 (form action 切替) は対象外
 *     (#2084 / 別 follow-up で扱う)
 *   - #2097 PR-B2: 旧 DashboardView は撤廃、ProdDashboardSections 単独構成へ統合済
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

// ============================================================================
// ADR-0047: UI Contract SSOT (Phase 1 — 型定義のみ、Phase 2 で toViewModel() 実装)
// ============================================================================
//
// 本 section は ADR-0047 で確定した「UI Contract 層」の型定義を提供する。
// ADR-0046 (Service Interface + Context DI) の上に乗る、追加層であり、
// ProdDashboardSections 等の UI コンポーネントは Phase 2 以降で本 ViewModel のみを受け取る
// (`PageData as never` キャスト排除)。#2097 PR-B2 (#2187) で DashboardView は撤廃済。
//
// 設計原則 (ADR-0047 §決定):
//   1. production / demo 両 Service が `toViewModel()` で同じ shape を生成
//   2. ProdDashboardSections は `ChildHomeViewModel` 以外の型を一切受け取らない (型強制)
//   3. divergence (進捗 UI / shop tab 等) は ViewModel field として明示化、隠蔽しない
//   4. type union (`progressDisplay.type`) は demo / production の identity ではなく
//      「子供の年齢 / プラン状態」コンテキストに紐付ける (深層調査 §5 案 B 失敗回避策)
//
// 関連:
//   - ADR-0047: Demo / 本番 UI Contract SSOT
//   - 深層調査: docs/research/2097-demo-prod-unification-architecture-deep-research.md
//   - 禁止語 SSOT: docs/decisions/forbidden-escape-language.md
//   - PO 13 質問回答: Issue #2097 本文 §更新 2026-05-14

// ---------------------------------------------------------------------------
// 子供画面 ViewModel (`ChildHomeViewModel`)
// ---------------------------------------------------------------------------

/**
 * 子供画面 (child home) で必要となる UI Contract。
 *
 * production / demo 両 Service が `toViewModel()` で本型と完全一致する shape を生成し、
 * `ProdDashboardSections` は本型以外を受け取らない (型強制 SSOT)。
 * (#2097 PR-B2 (#2187) で旧 `DashboardView` を撤廃、本番 UI 単独構成に統合)
 *
 * 機能セット parity (Q5 = B 子供は買える / Q6 = B 51+ Activity / Q7 = C 5 年齢モード全提供) を
 * field レベルで明示化することで、divergence を contract 違反として検出可能にする。
 */
export interface ChildHomeViewModel {
	/** 表示中の子供 (header / profile area で表示)。null は SSR 初期状態のみ許容 */
	child: ChildHomeChild;

	/**
	 * 通貨表示 (Q4 = A demo 固定 P、production は設定追従)。
	 *
	 * - demo: 常に `{ symbol: 'P', code: 'POINTS' }`
	 * - production: PointSettings から導出 (将来円対応時は `symbol: '¥', code: 'JPY'` も追加可能)
	 */
	currency: ChildHomeCurrency;

	/**
	 * 進捗表示 (年齢モード / プラン状態で type 切替、demo / production の identity 固定 NG)。
	 *
	 * 深層調査 §5 案 B 失敗リスク回避: type union は「demo は今日のおやくそく、本番は Lv 表示」
	 * のような identity 固定ではなく、「baby / 親プラン → today-missions、elementary 以上で
	 * standard プラン → category-level」のようなコンテキスト法則で切替わる。
	 */
	progressDisplay: ChildHomeProgressDisplay;

	/**
	 * Activity grid (51+ 件、5 カテゴリ × 各複数件、マーケットプレイス pack SSOT)。
	 *
	 * - demo: `src/lib/data/marketplace/activity-packs/*.json` (12 pack) から年齢 / 性別で seed
	 * - production: 家族別の DB データを Drizzle から取得
	 * - 件数 contract: Q6 = B (51+、本番同等)
	 */
	activities: readonly ChildHomeActivity[];

	/**
	 * 9 feature の表示可否 contract。demo / production で異なる feature を ViewModel field で
	 * 明示化することで、`<ProdDashboardSections>` 内に `if (service.kind === 'demo')` 分岐を書かない (ADR-0046 整合)。
	 *
	 * Phase 1 では全 feature の boolean field のみ定義。Phase 2 で各 feature の実装に配線する。
	 */
	features: ChildHomeFeatureFlags;

	/** 5 年齢モード (Q7 = C 全モード提供、baby = ADR-0011 親準備モード) */
	uiMode: 'baby' | 'preschool' | 'elementary' | 'junior' | 'senior';

	/**
	 * 年齢 / プラン状態コンテキスト。
	 *
	 * `progressDisplay.type` 切替判定や、baby モードでの ADR-0011 親準備モード判定に使う。
	 * UI が「年齢を見て分岐」するのではなく、ViewModel が事前に分岐済み状態を渡す方針。
	 */
	ageContext: ChildHomeAgeContext;
}

/** child header / profile に必要なフィールド (subset of Child) */
export interface ChildHomeChild {
	id: number;
	nickname: string;
	pointBalance: number;
	level: number;
	xpToNextLevel: number;
	xpInLevel: number;
	streakDays: number;
	uiMode: 'baby' | 'preschool' | 'elementary' | 'junior' | 'senior';
}

/** 通貨表示 contract (Q4) */
export interface ChildHomeCurrency {
	/** 表示記号 (UI 用、'P' or '¥' 等) */
	symbol: string;
	/** internal code (将来円対応時に使う、現状は 'POINTS' 固定) */
	code: 'POINTS' | 'JPY';
}

/**
 * 進捗表示 type union (深層調査 §5 案 B core)。
 *
 * **identity 固定 NG**: demo / production を identity で固定すると、deep research §5 案 B の
 * 失敗リスクが発現する。type 切替は **コンテキスト法則** (年齢 / プラン状態) に従わせる。
 */
export type ChildHomeProgressDisplay =
	| {
			/**
			 * カテゴリ別レベル表示 (5 カテゴリそれぞれの level + XP bar)。
			 *
			 * 適用コンテキスト: elementary 以上 + standard プラン以上 (production / demo 両方で発現可能)
			 */
			type: 'category-level';
			categories: readonly {
				id: number;
				name: string;
				level: number;
				xpPercent: number; // 0-100
			}[];
	  }
	| {
			/**
			 * 今日のおやくそく / ミッション表示 (must / daily の status)。
			 *
			 * 適用コンテキスト: baby / preschool / または free プラン (production / demo 両方で発現可能)
			 */
			type: 'today-missions';
			mustStatus: {
				completed: number;
				total: number;
			};
			dailyMissions: {
				completed: number;
				total: number;
			};
	  };

/** Activity grid 1 件分 */
export interface ChildHomeActivity {
	id: number;
	name: string;
	icon: string; // emoji or asset path
	categoryId: number;
	categoryName: string;
	pointReward: number;
	streakBonus: number;
	isPinned: boolean;
	/** 今日記録済み件数 (UI: badge 表示) */
	todayRecorded: number;
	/** 必須活動かどうか (must / daily mission) */
	isMust: boolean;
}

/**
 * 9 feature の表示可否 contract。
 *
 * - 各 field は **boolean のみ** で表現 (action signature は含めない、ADR-0047 §決定 Q5)。
 * - demo / production で異なる場合は 必ず field レベル divergence として現れる (隠蔽不可)。
 */
export interface ChildHomeFeatureFlags {
	/** Shop タブ表示 (Q5 = B 子供 = 常に true、demo でも実購入動作 sessionStorage) */
	showShopTab: boolean;
	/** 活動記録時の XP アニメーション */
	showXpAnimation: boolean;
	/** Mission badge (today / streak) 表示 */
	showMissionBadge: boolean;
	/** Pin (ピン留め) ボタン表示 */
	showPinButton: boolean;
	/** Event badge (期間限定イベント) 表示 */
	showEventBadge: boolean;
	/** Sibling ranking (兄弟ランキング) 表示 */
	showSiblingRanking: boolean;
	/** Birthday bonus 表示 */
	showBirthdayBonus: boolean;
	/** Monthly reward 表示 */
	showMonthlyReward: boolean;
	/** Stamp card 表示 (おみくじスタンプ) */
	showStampCard: boolean;
}

/**
 * 年齢 / プラン状態コンテキスト。
 *
 * `progressDisplay.type` の切替判定および baby モード判定の SSOT。
 * UI 層で `if (uiMode === 'baby')` を書かない (ADR-0015 アンチパターン A1 回避)。
 */
export interface ChildHomeAgeContext {
	/** baby (0-2 歳) = ADR-0011 親準備モード (子供画面ではなく親 UI 表示) */
	isBabyParentMode: boolean;
	/** ageTier コード (`age-tier.ts` から取得) */
	ageTier: 'baby' | 'preschool' | 'elementary' | 'junior' | 'senior';
	/** plan tier (production = 実プラン / demo = 'standard' 固定) */
	planTier: 'free' | 'standard' | 'family';
	/** trial 中フラグ (demo = false 固定) */
	isTrialActive: boolean;
}

// ---------------------------------------------------------------------------
// 親画面 ViewModel (`ParentAdminViewModel`)
// ---------------------------------------------------------------------------

/**
 * 親画面 (parent admin) 「見せるだけ」UI Contract (Q11 = D)。
 *
 * 設計原則 (ADR-0047 §決定 Q11=D + Q5):
 *   - **action signature を持たない** (read-only fields のみ): 親画面は demo では「クリックできるが
 *     書込み発生しない」状態をデフォルトとする。型レベルで action callback を含めないことで、
 *     demo 実装が誤って書込み logic を埋め込まないように構造的阻止
 *   - production = `isPreviewOnly: false` で同じ ViewModel を使うが、page 側で action handler を
 *     別途配線する (Phase 4 で page 側に薄ラッパを設置)
 *   - demo = `isPreviewOnly: true` で notice バナー表示 + 全 button click no-op
 *
 * UI divergence は contract レベルで意図的に許容 (Q11 = D: 親画面は LP 訴求 + 見るだけ)。
 */
export interface ParentAdminViewModel {
	/**
	 * プレビュー専用モードフラグ (demo / production 識別の唯一の SSOT)。
	 *
	 * - demo: `true` → notice バナー表示 + 全 action no-op
	 * - production: `false` → page 側で action handler 配線
	 */
	isPreviewOnly: boolean;

	/**
	 * プレビュー notice メッセージ (demo only)。
	 *
	 * `isPreviewOnly: true` の時のみ含まれる。文言は `PARENT_ADMIN_LABELS.previewNotice` 経由 (ADR-0045)。
	 * 例: 「これは見るだけのプレビューです。実際のアカウントでお試しいただくにはサインアップしてください。」
	 */
	previewNoticeMessage?: string;

	/**
	 * プリセット (activity packs) 一覧。
	 *
	 * 親画面ではプリセット選択 / 追加 / 削除を行うが、demo では visible のみ (action no-op)。
	 * field は read-only (display 用) のみ含み、action callback signature は ViewModel に含めない。
	 */
	presets: readonly ParentAdminReadonlyPreset[];

	/**
	 * ごほうび (rewards) 一覧。同じく display only。
	 */
	rewards: readonly ParentAdminReadonlyReward[];

	/**
	 * 家族メンバー (children + parents) 一覧。同じく display only。
	 */
	members: readonly ParentAdminReadonlyMember[];

	/**
	 * 親管理画面で表示する追加要素 (Phase 4 で詳細化、Phase 1 では拡張余地として field 定義のみ)。
	 *
	 * - reports: 月次レポート (display only、demo はサンプルデータ)
	 * - settings: 各種設定 (display only)
	 */
	reports: readonly ParentAdminReadonlyReport[];
	settings: ParentAdminReadonlySettings;
}

/** プリセット (display only) */
export interface ParentAdminReadonlyPreset {
	id: number;
	name: string;
	activitiesCount: number;
	description?: string;
}

/** ごほうび (display only) */
export interface ParentAdminReadonlyReward {
	id: number;
	name: string;
	pointCost: number;
	icon: string;
}

/** 家族メンバー (display only) */
export interface ParentAdminReadonlyMember {
	id: number;
	name: string;
	role: 'parent' | 'child';
	uiMode?: 'baby' | 'preschool' | 'elementary' | 'junior' | 'senior';
	birthday?: string;
}

/** 月次レポート (display only) */
export interface ParentAdminReadonlyReport {
	month: string; // YYYY-MM
	totalActivities: number;
	totalPoints: number;
	topCategoryName: string;
}

/** 各種設定 (display only) */
export interface ParentAdminReadonlySettings {
	notificationEnabled: boolean;
	cheerMessage: string;
	autoSleepEnabled: boolean;
}
