import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminChildren;

export const CHILDREN_GUIDE: PageGuide = {
	pageId: 'admin-children',
	title: L.title,
	icon: '👦',
	steps: [
		// ① ページ概要
		{
			id: 'children-intro',
			...L.steps['children-intro'],
		},
		// ② 画面の見方
		{
			id: 'children-list',
			selector: '[data-tutorial="children-list"]',
			...L.steps['children-list'],
			position: 'bottom',
		},
		// ③ 最頻操作
		{
			id: 'children-add',
			selector: '[data-tutorial="add-child-btn"]',
			...L.steps['children-add'],
			position: 'bottom',
		},
	],
};
