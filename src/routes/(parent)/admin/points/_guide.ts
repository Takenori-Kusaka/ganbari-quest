import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。巨大要素 (points-section) は target にしない。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminPoints;

export const POINTS_GUIDE: PageGuide = {
	pageId: 'admin-points',
	title: L.title,
	icon: '💰',
	steps: [
		// ① ページ概要
		{
			id: 'points-intro',
			...L.steps['points-intro'],
		},
		// ② 画面の見方
		{
			id: 'points-balances',
			selector: '[data-tutorial="points-child-balances"]',
			...L.steps['points-balances'],
			position: 'bottom',
		},
		// ③ 最頻操作（交換の起点 = 残高カードを target にする小要素）
		{
			id: 'points-convert',
			// 交換の起点である残高カード (常設の小要素) を highlight する。カードをタップすると
			// その下に交換フォームが開く。交換フォーム全体 (mode タブ + 入力 + ボタンが縦に連なる)
			// を target にすると driver.js が非重複でバブルを置けないため、起点のカードのみを指す
			// (#2927: 中央 modal から具体要素 highlight に戻す)。
			selector: '[data-tutorial="points-first-balance"]',
			...L.steps['points-convert'],
			position: 'bottom',
		},
	],
};
