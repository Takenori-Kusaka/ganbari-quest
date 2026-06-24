import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3263 (EPIC #3260 F2) / #3269 (C5): みんなのテンプレート（マーケットプレイス）一覧ガイド。
// AdminLayout 非使用ページのため marketplace/+layout.svelte が独自配線する。
// #3269 で取込 CUJ（探す → カードで詳細を開く → 取り込む）を案内する 3 部構成に拡充。
// 詳細ルート /marketplace/[type]/[itemId] は dedicated guide（MARKETPLACE_DETAIL_GUIDE）を持つ。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.marketplace;

export const MARKETPLACE_GUIDE: PageGuide = {
	pageId: 'marketplace',
	title: L.title,
	icon: '🛍️',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal 表示）
		{
			id: 'marketplace-intro',
			...L.steps['marketplace-intro'],
		},
		// ② 画面の見方（種類で絞り込む = type filter のスポットライト）
		{
			id: 'marketplace-browse',
			selector: '[data-tutorial="marketplace-type-filter"]',
			...L.steps['marketplace-browse'],
			position: 'bottom',
		},
		// ③ 最頻操作（カードをタップして詳細を開く = 先頭カードのスポットライト）
		{
			id: 'marketplace-open',
			selector: '[data-tutorial="marketplace-item-card"]',
			...L.steps['marketplace-open'],
			position: 'bottom',
		},
	],
};
