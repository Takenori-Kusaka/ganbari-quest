/**
 * ご家族の見守り画面ホーム — ページガイド定義
 *
 * 【設計意図】
 * 本ガイドは「ユーザーマニュアルを別途用意しない」という
 * プロダクト判断を可能にする唯一の手段である。
 *
 * #4653 (EPIC #4650 PO 判断 4 / 5): 3 step 固定をやめ、画面の上から下の順に主要ブロックを
 * 網羅する。「押す」と書く step は必ず実要素に spotlight する — 条件付き UI (承認待ちバナー /
 * 今月のがんばり) と viewport 別 nav は `optional: true` で宣言し、AdminLayout が起動直前に
 * `filterGuideStepsByPresence` (#4668 / #4677) → `filterGuideStepsByTargetPresence` (#4653) を
 * 最後段で直列適用して「描画されている step だけ」を残す。desktop では header 下の nav、mobile
 * では画面下部の nav が光る (旧 step 3 は mobile 専用 nav のみを指し desktop で 0×0 だった、F2)。
 *
 * #3264 (EPIC #3260 F3): 表示文言 (title / what / how / goal / tips) は labels.ts の
 * PAGE_GUIDE_LABELS に SSOT 集約。本ファイルは構造フィールド (pageId / icon / selector /
 * position / step id) と labels 参照のみを保持する。
 */

import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

const L = PAGE_GUIDE_LABELS.adminHome;

export const ADMIN_HOME_GUIDE: PageGuide = {
	pageId: 'admin-home',
	title: L.title,
	icon: '🏠',
	steps: [
		// ① ページ概要 — selector 省略で画面中央に表示
		{
			id: 'home-intro',
			...L.steps['home-intro'],
		},
		// 承認待ちバナー (交換申請が 1 件以上あるときだけ描画される条件付き step)
		{
			id: 'home-pending',
			selector: '[data-tutorial="redemption-pending-banner"]',
			...L.steps['home-pending'],
			optional: true,
			position: 'bottom',
		},
		// ② 画面の見方 — 上部カード (こどもの数 / 合計 = 残高合計)
		{
			id: 'home-summary',
			selector: '[data-tutorial="summary-cards"]',
			...L.steps['home-summary'],
			position: 'bottom',
		},
		// 今月のがんばり (お子さま 1 人以上のときだけ描画される条件付き step)
		{
			id: 'home-monthly',
			selector: '[data-tutorial="monthly-summary"]',
			...L.steps['home-monthly'],
			optional: true,
			position: 'bottom',
		},
		// こども一覧 (0 人のときも section は描画される)
		{
			id: 'home-children',
			selector: '[data-tutorial="children-overview"]',
			...L.steps['home-children'],
			position: 'top',
		},
		// ③ 最頻操作 — 子供画面へ切替 (header 右端、常設)
		{
			id: 'home-switch',
			selector: '[data-tutorial="switch-to-child"]',
			...L.steps['home-switch'],
			position: 'bottom',
		},
		// ③ 最頻操作 — 各機能へ移動。desktop は header 下の nav (mobile では display:none で除外)、
		// mobile は画面下部の nav (desktop では display:none で除外)。文言は共通 ('home-nav')。
		{
			id: 'home-nav-desktop',
			selector: '[data-tutorial="nav-desktop"]',
			...L.steps['home-nav'],
			optional: true,
			position: 'bottom',
		},
		{
			id: 'home-nav-mobile',
			selector: '[data-tutorial="nav-primary"]',
			...L.steps['home-nav'],
			optional: true,
			position: 'top',
		},
	],
};
