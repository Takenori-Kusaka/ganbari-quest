/**
 * ページ別オンデマンドガイド — 型定義
 *
 * 【設計意図】
 * 本ガイドは「ユーザーマニュアルを別途用意しない」という
 * プロダクト判断を可能にする唯一の手段である。
 *
 * 各ステップは以下の三部構成を必ず満たすこと:
 * 1. what: 何ができる
 * 2. how: どう設定する（具体的な操作手順）
 * 3. goal: 設定した結果どうなるか（具体例）
 *
 * 「これは○○です」という浅い説明は禁止。
 * 実装者は「マニュアルを書いている」つもりで深く書くこと。
 */

import type { PlanTier } from './tutorial-types';

/** ページガイドの1ステップ */
export interface GuideStep {
	/** ステップ一意ID（例: "activities-add"） */
	id: string;
	/** 対象要素の CSS セレクタ（省略時は画面中央に表示） */
	selector?: string;
	/** 機能名（例: 「活動の追加」） */
	title: string;

	// 三部構成
	/** 何ができる: この機能で何が実現できるか（1〜2文） */
	what: string;
	/** どう設定する: 具体的な操作手順（番号付きリスト推奨） */
	how: string;
	/** ゴールイメージ: 設定した結果どうなるか（具体例で） */
	goal: string;

	// 補助情報
	/** 注意点・コツ（labels.ts の `as const` 由来で readonly。表示専用、変更しない） */
	tips?: readonly string[];
	/** 関連機能への導線 */
	relatedLinks?: readonly { label: string; href: string }[];
	/** この手順を表示する最低プランティア */
	requiredTier?: PlanTier;
	/**
	 * この手順を表示する実行モード制約（#3291 / #3296）。
	 * - 'saas': SaaS（aws-prod / local-debug / demo / build）でのみ表示し、NUC（nuc-prod）では除外。
	 *   NUC では当該 UI セクション（現在のプラン / プラン管理 等）が存在せず、selector が解決できず
	 *   空 spotlight + 実装にない操作案内になる（ADR-0013）ため。
	 * - 'nuc': NUC（nuc-prod）でのみ表示し、SaaS では除外（#3296）。NucLicensePanel 固有の
	 *   Edition badge / 利用状況セクションを spotlight する NUC 専用手順に使う。
	 * 未指定は全モードで表示。判定は {@link filterGuideStepsByRuntime}（runtimeMode 未確定時は
	 * fail-closed で saas / nuc いずれの限定手順も除外）。
	 */
	requiredRuntime?: 'saas' | 'nuc';
	/**
	 * この手順を表示する Stripe 決済の有効性制約（#3296）。
	 * 'enabled' を指定した手順は `stripeEnabled === true`（STRIPE_SECRET_KEY 設定済）のときのみ表示する。
	 * 例: subscription-plan-management は SaasLicensePanel の `{#if stripeEnabled}` ブロック内 UI を
	 * spotlight するため、Stripe 無効な local-debug / demo では selector 未解決 → 空 spotlight になる
	 * （runtimeMode='saas' 軸とは直交、ADR-0061 same-class）。未指定は Stripe 有無に関わらず表示。
	 * 判定は {@link filterGuideStepsByStripe}（stripeEnabled 未確定時は fail-closed で除外）。
	 */
	requiredStripe?: 'enabled';
	/**
	 * 対象要素が「画面の状態」で出たり消えたりする step (#4668 / EPIC #4650 PO 判断 4)。
	 * `true` の step は、ガイド起動時に `selector` が可視要素に解決しなければ **step ごと除外**する
	 * ({@link filterGuideStepsByPresence})。例: 無料プランのときだけ出る「無料トライアルを開始する」
	 * カード、保留中の招待があるときだけ出る一覧、0 件時に消える操作ボタン。
	 * tier / runtime / stripe の静的 filter では表現できない「ページ状態依存 UI」を、中央 fallback
	 * (押せと言われたボタンが光らない) にせず宣言的に扱うための軸。`selector` 無しの step には無意味。
	 * 常設 UI を指す step には付けない (付けると anchor 退行を silent に隠すため)。
	 */
	optional?: boolean;
	/** バブルの表示位置 */
	position?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
}

/** 1ページ分のガイド定義 */
export interface PageGuide {
	/** ページ識別子（例: "admin-home", "admin-activities"） */
	pageId: string;
	/** ページ名（ヘッダー表示用） */
	title: string;
	/** ページアイコン */
	icon: string;
	/** ステップ一覧 */
	steps: GuideStep[];
}
