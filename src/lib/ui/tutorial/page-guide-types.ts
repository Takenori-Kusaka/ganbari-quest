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
	/** 注意点・コツ */
	tips?: string[];
	/** 関連機能への導線 */
	relatedLinks?: { label: string; href: string }[];
	/** この手順を表示する最低プランティア */
	requiredTier?: PlanTier;
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
