import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。section 見出し (小要素) を target にする。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminCheer;

export const CHEER_GUIDE: PageGuide = {
	pageId: 'admin-cheer',
	title: L.title,
	icon: '🎉',
	steps: [
		// ① ページ概要
		{
			id: 'cheer-intro',
			...L.steps['cheer-intro'],
		},
		// ② 画面の見方
		{
			id: 'cheer-select',
			selector: '[data-tutorial="cheer-select-heading"]',
			...L.steps['cheer-select'],
			position: 'bottom',
		},
		// ③ 最頻操作
		{
			id: 'cheer-reason',
			selector: '[data-tutorial="cheer-reason-heading"]',
			...L.steps['cheer-reason'],
			position: 'bottom',
		},
	],
};
