import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ「成長記録ブック」のページガイド。
// 利用頻度が低いため簡潔（②画面の見方 → ③最頻操作の 2 step、selector 省略で画面中央 modal）。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminGrowthBook;

export const GROWTH_BOOK_GUIDE: PageGuide = {
	pageId: 'admin-growth-book',
	title: L.title,
	icon: '📖',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal 表示）
		{
			id: 'growth-book-intro',
			...L.steps['growth-book-intro'],
		},
		// ② 画面の見方 + 最頻操作（年度・お子さまの切り替えと印刷）
		{
			id: 'growth-book-view',
			...L.steps['growth-book-view'],
		},
	],
};
