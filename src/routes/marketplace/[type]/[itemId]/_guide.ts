import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { GuideStep, PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3269 (EPIC #3260 C5) / #4678 (EPIC #4650): みんなのテンプレート詳細（取込 CTA ページ）の dedicated guide。
// 一覧から開いた 1 件の詳細。AdminLayout 非使用のため marketplace/+layout.svelte が独自配線する。
// registry の PARAMETERIZED_GUIDE_MATCHERS で /marketplace/<type>/<itemId> 実パスから本ガイドに
// 解決され、親 /marketplace ガイドへの degrade（#3262 F1）を上書きする。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
//
// #4678: 取込 CTA は type × ログイン × お子さま登録で 5 分岐し (+page.svelte の `data-cta-variant`)、
// 「お子さまを選ぶ画面に進む」の 1 パスだけでは未ログイン / お子さま未登録 / とくべつルール
// (家庭全体に即取込、penalty・special はボタン無し) の顧客に話が合わない。分岐ごとの step を
// `optional: true` で用意し、engine (PageGuideOverlay) が起動時点の DOM に出ている分岐の step だけを残す。
const L = PAGE_GUIDE_LABELS.marketplaceDetail;

const CTA = '[data-testid="marketplace-detail-cta"]';

/** CTA ブロックの分岐 (data-cta-variant) ごとの取り込み step。画面に出ている 1 つだけが残る。 */
const IMPORT_STEPS: GuideStep[] = [
	{
		id: 'marketplace-detail-import',
		selector: `${CTA}[data-cta-variant="per-child"]`,
		optional: true,
		...L.steps['marketplace-detail-import'],
		position: 'top',
	},
	{
		id: 'marketplace-detail-import-rule',
		selector: `${CTA}[data-cta-variant="family-rule"]`,
		optional: true,
		...L.steps['marketplace-detail-import-rule'],
		position: 'top',
	},
	{
		id: 'marketplace-detail-rule-unavailable',
		selector: `${CTA}[data-cta-variant="rule-unavailable"]`,
		optional: true,
		...L.steps['marketplace-detail-rule-unavailable'],
		position: 'top',
	},
	{
		id: 'marketplace-detail-no-children',
		selector: `${CTA}[data-cta-variant="no-children"]`,
		optional: true,
		...L.steps['marketplace-detail-no-children'],
		position: 'top',
	},
	{
		id: 'marketplace-detail-login',
		selector: `${CTA}[data-cta-variant="login"]`,
		optional: true,
		...L.steps['marketplace-detail-login'],
		position: 'top',
	},
];

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
		// ③ 活動セットの取り込む項目を選ぶ（活動セット + ログイン + お子さま登録済のときだけ描画 → optional）
		{
			id: 'marketplace-detail-select',
			selector: '[data-tutorial="marketplace-detail-select"]',
			optional: true,
			...L.steps['marketplace-detail-select'],
			position: 'bottom',
		},
		// ④ 取り込む（出ている分岐の 1 step だけ残る）
		...IMPORT_STEPS,
	],
};
