import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ「成長記録ブック」のページガイド。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
// #4675 (EPIC #4650): 旧 2 step は selector 省略の中央 modal で、存在しない年度切替 UI と
//   分野別一覧を案内していた。画面の DOM 順 (お子さま切替 → 年間サマリー → 印刷 → 証明書リンク) に
//   anchor を張り、描画条件を持つ step (子供 2 人以上 / 記録あり / 有料プラン) は `optional` にする。
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
		// ② お子さま切替（子供 2 人以上のときだけ描画）
		{
			id: 'growth-book-child-tabs',
			selector: '[data-tutorial="growth-book-child-tabs"]',
			...L.steps['growth-book-child-tabs'],
			optional: true,
			position: 'bottom',
		},
		// ③ 年間サマリー（記録があるときだけ描画）
		{
			id: 'growth-book-summary',
			selector: '[data-tutorial="growth-book-summary"]',
			...L.steps['growth-book-summary'],
			optional: true,
			position: 'bottom',
		},
		// ④ 印刷（有料プラン かつ 記録があるときだけ描画）
		{
			id: 'growth-book-print',
			selector: '[data-tutorial="growth-book-print"]',
			...L.steps['growth-book-print'],
			optional: true,
			position: 'bottom',
		},
		// ⑤ 証明書一覧へ（記録があるときだけ描画）
		{
			id: 'growth-book-certificates',
			selector: '[data-tutorial="growth-book-certificates"]',
			...L.steps['growth-book-certificates'],
			optional: true,
			position: 'top',
		},
	],
};
