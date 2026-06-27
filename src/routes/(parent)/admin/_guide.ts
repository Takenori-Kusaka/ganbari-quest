/**
 * ご家族の見守り画面ホーム — ページガイド定義
 *
 * 【設計意図】
 * 本ガイドは「ユーザーマニュアルを別途用意しない」という
 * プロダクト判断を可能にする唯一の手段である。
 *
 * #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」の
 * 3 部構成に統一。step 1 は selector を省略し画面中央 modal で「このページは何か」を提示する
 * (巨大要素を step target にしないことで PageGuideOverlay の幾何回避不能ケースを根絶する)。
 * 各ステップは三部構成（what/how/goal）を必ず満たすこと。
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
		// ② 画面の見方
		{
			id: 'home-summary',
			// summary-cards 行は横長 (~864px) かつ viewport 下端付近に位置するため、driver.js が
			// バブルを上下左右どこにも非重複で置けない (短く幅広な要素 + 下端 = clear 余地不足)。
			// 中央 modal (selector 省略) で「画面の見方」を説明し、確実に非重複・viewport 内に収める。
			...L.steps['home-summary'],
		},
		// ③ 最頻操作
		{
			id: 'home-nav',
			selector: '[data-tutorial="nav-primary"]',
			...L.steps['home-nav'],
			position: 'top',
		},
	],
};
