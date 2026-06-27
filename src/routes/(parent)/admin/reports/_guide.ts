import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminReports;

export const REPORTS_GUIDE: PageGuide = {
	pageId: 'admin-reports',
	title: L.title,
	icon: '📊',
	steps: [
		// ① ページ概要
		{
			id: 'reports-intro',
			...L.steps['reports-intro'],
		},
		// ② 画面の見方
		{
			id: 'reports-tabs',
			selector: '[data-tutorial="report-tabs"]',
			...L.steps['reports-tabs'],
			position: 'bottom',
		},
		// ③ 最頻操作
		{
			id: 'reports-growth-book',
			selector: '[data-tutorial="growth-book-link"]',
			...L.steps['reports-growth-book'],
			position: 'bottom',
		},
	],
};
