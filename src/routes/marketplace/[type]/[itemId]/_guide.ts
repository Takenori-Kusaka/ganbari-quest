import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3269 (EPIC #3260 C5): みんなのテンプレート詳細（取込 CTA ページ）の dedicated guide。
// 一覧から開いた 1 件の詳細。AdminLayout 非使用のため marketplace/+layout.svelte が独自配線する。
// registry の PARAMETERIZED_GUIDE_MATCHERS で /marketplace/<type>/<itemId> 実パスから本ガイドに
// 解決され、親 /marketplace ガイドへの degrade（#3262 F1）を上書きする。
// 取込 CUJ の終盤（中身プレビューの見方 → 取り込み = 配信先のお子さま選択）を案内する 3 部構成。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.marketplaceDetail;

export const MARKETPLACE_DETAIL_GUIDE: PageGuide = {
	pageId: 'marketplace-detail',
	title: L.title,
	icon: '🛍️',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal 表示）
		{
			id: 'marketplace-detail-intro',
			...L.steps['marketplace-detail-intro'],
		},
		// ② 内容プレビューの見方（含まれる項目一覧のスポットライト）
		{
			id: 'marketplace-detail-preview',
			selector: '[data-tutorial="marketplace-detail-preview"]',
			...L.steps['marketplace-detail-preview'],
			position: 'top',
		},
		// ③ 取り込む（取込 CTA = 配信先のお子さま選択へ進む）
		{
			id: 'marketplace-detail-import',
			selector: '[data-testid="marketplace-detail-cta"]',
			...L.steps['marketplace-detail-import'],
			position: 'top',
		},
	],
};
