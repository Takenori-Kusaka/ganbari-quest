import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3263 (EPIC #3260 F2): みんなのテンプレート（マーケットプレイス）の最小 intro ガイド。
// AdminLayout 非使用ページのため marketplace/+layout.svelte が独自配線する。
// 機構配線が目的のため intro 中心の 2 step に留める（リッチコンテンツは C5 #3269 が拡充）。
// 詳細ルート /marketplace/[type]/[itemId] は registry の親パスフォールバック（#3262 F1）で
// 本ガイドに degrade するため、別途 dedicated guide は持たない。
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
		// ② よく使う操作（種類で絞り込む）
		{
			id: 'marketplace-browse',
			selector: '[data-tutorial="marketplace-type-filter"]',
			...L.steps['marketplace-browse'],
			position: 'bottom',
		},
	],
};
