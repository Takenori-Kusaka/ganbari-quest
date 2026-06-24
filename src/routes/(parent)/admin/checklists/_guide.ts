import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。巨大要素 (checklists-page) は target にせず、
// step 2 はページ見出し (小要素) を target にする。
// 用語は #2909 (PO 指摘 #2899 AC3) で「持ち物チェックリスト管理 → チェックリスト管理」へ是正済み。
// チェックリストは持ち物に限らない汎用機能で、持ち物は代表ユースケースとして本文に例示する。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminChecklists;

export const CHECKLISTS_GUIDE: PageGuide = {
	pageId: 'admin-checklists',
	title: L.title,
	icon: '📋',
	steps: [
		// ① ページ概要
		{
			id: 'checklists-intro',
			...L.steps['checklists-intro'],
		},
		// ② 画面の見方
		{
			id: 'checklists-header',
			selector: '[data-tutorial="checklists-header"]',
			...L.steps['checklists-header'],
			position: 'bottom',
		},
		// ③ 最頻操作
		{
			id: 'checklists-marketplace',
			selector: '[data-tutorial="checklists-marketplace"]',
			...L.steps['checklists-marketplace'],
			position: 'bottom',
		},
	],
};
