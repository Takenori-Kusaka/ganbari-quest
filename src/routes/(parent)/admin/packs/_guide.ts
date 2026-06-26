import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3268 (EPIC #3260 C4): パック（活動パック一括取込）ページガイド。
// 展開コンテンツ / 取込ボタンは条件表示（expandedPack / isFullyImported 依存）のため step の
// anchor にせず、常在する見出しを指す 2 step 構成（①概要 → ②画面の見方）。MAX_STEPS=5 の範囲内。
// 文言は labels.ts に集約（#3264 / F3）。
const L = PAGE_GUIDE_LABELS.adminPacks;

export const PACKS_GUIDE: PageGuide = {
	pageId: 'admin-packs',
	title: L.title,
	icon: '📦',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'packs-intro',
			...L.steps['packs-intro'],
		},
		// ② 画面の見方（パック一覧）— 常在する見出しを anchor（一覧は取込導線を含む）
		{
			id: 'packs-overview',
			selector: '[data-tutorial="packs-overview"]',
			...L.steps['packs-overview'],
			position: 'bottom',
		},
	],
};
