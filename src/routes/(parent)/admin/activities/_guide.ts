import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// 旧構成 (フィルタ説明から開始) を是正し、step 1 は selector 省略で画面中央 modal 表示。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminActivities;

export const ACTIVITIES_GUIDE: PageGuide = {
	pageId: 'admin-activities',
	title: L.title,
	icon: '📋',
	steps: [
		// ① ページ概要
		{
			id: 'activities-intro',
			...L.steps['activities-intro'],
		},
		// ② 画面の見方
		{
			id: 'activities-filter',
			selector: '[data-tutorial="category-filter"]',
			...L.steps['activities-filter'],
			position: 'bottom',
		},
		// ③ 最頻操作
		{
			id: 'activities-add',
			selector: '[data-tutorial="add-activity-btn"]',
			...L.steps['activities-add'],
			requiredTier: 'standard',
			position: 'bottom',
		},
	],
};
