import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3267 (EPIC #3260 C3): プラン・課金（subscription）ページガイド。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
// #3291: SaaS step は SaasLicensePanel 専用 UI を指すため requiredRuntime='saas'。NUC 版
//        (NucLicensePanel) には現在のプラン / プラン管理セクションが無く、selector 未解決 →
//        空 spotlight + 実装にない操作案内になるため nuc-prod では除外する（ADR-0013 truth）。
// #3296: (1) プラン管理 step は `{#if stripeEnabled}` ブロック内 UI を指すため requiredStripe='enabled'
//        を併記し、Stripe 無効な local-debug/demo の空 spotlight も塞ぐ。(2) NUC 専用 step を
//        requiredRuntime='nuc' で出し分ける（filterGuideStepsByRuntime）。
// #4668 (EPIC #4650): 3 step 固定をやめ、画面の DOM 順に「上から下」で主要操作を網羅する。
//        - data-tutorial は見出し h3 ではなく Card ラッパに付け、説明している値行 / ボタンを含む領域を光らせる
//        - 利用状況カード (PlanStatusCard) / 解約リンク / NUC サポートを step 化
//        - 無料トライアル開始カードは free + 未使用のときしか描画されないため `optional: true`
//          (filterGuideStepsByPresence が起動時 DOM で判定し、無ければ step ごと省く)
const L = PAGE_GUIDE_LABELS.adminSubscription;

export const SUBSCRIPTION_GUIDE: PageGuide = {
	pageId: 'admin-subscription',
	title: L.title,
	icon: '💳',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal、全環境で表示）
		{
			id: 'subscription-intro',
			...L.steps['subscription-intro'],
		},
		// ② 画面の見方（現在のプラン）— SaaS 版のみ。Card 全体を spotlight
		{
			id: 'subscription-current-plan',
			selector: '[data-tutorial="subscription-current-plan"]',
			...L.steps['subscription-current-plan'],
			requiredRuntime: 'saas',
			position: 'bottom',
		},
		// ③ 画面の見方（利用状況と上限）— SaaS 版のみ。PlanStatusCard (上限 / トライアル残り日数 / アップグレード CTA)
		{
			id: 'subscription-plan-status',
			selector: '[data-tutorial="subscription-plan-status"]',
			...L.steps['subscription-plan-status'],
			requiredRuntime: 'saas',
			position: 'bottom',
		},
		// ④ 最頻操作（無料トライアルを開始する）— SaaS 版 + free で未使用のときだけ描画されるカード
		{
			id: 'subscription-trial',
			selector: '[data-tutorial="subscription-trial"]',
			...L.steps['subscription-trial'],
			requiredRuntime: 'saas',
			optional: true,
			position: 'bottom',
		},
		// ⑤ 最頻操作（プラン管理）— SaaS 版 + Stripe 有効時のみ（#3296）。Card 全体を spotlight
		{
			id: 'subscription-plan-management',
			selector: '[data-tutorial="subscription-plan-management"]',
			...L.steps['subscription-plan-management'],
			requiredRuntime: 'saas',
			requiredStripe: 'enabled',
			position: 'bottom',
		},
		// ⑥ 解約の入口 — SaaS 版のみ。ページ末尾の「解約をご検討の方」リンク
		{
			id: 'subscription-cancel',
			selector: '[data-tutorial="subscription-cancel"]',
			...L.steps['subscription-cancel'],
			requiredRuntime: 'saas',
			position: 'top',
		},
		// ②' 画面の見方（ご利用中の版）— NUC 版のみ（#3296）
		{
			id: 'subscription-nuc-edition',
			selector: '[data-tutorial="nuc-edition"]',
			...L.steps['subscription-nuc-edition'],
			requiredRuntime: 'nuc',
			position: 'bottom',
		},
		// ③' 画面の見方（利用状況）— NUC 版のみ（#3296）。Card 全体を spotlight
		{
			id: 'subscription-nuc-usage',
			selector: '[data-tutorial="nuc-usage"]',
			...L.steps['subscription-nuc-usage'],
			requiredRuntime: 'nuc',
			position: 'bottom',
		},
		// ④' サポート — NUC 版のみ（#4668）
		{
			id: 'subscription-nuc-support',
			selector: '[data-tutorial="nuc-support"]',
			...L.steps['subscription-nuc-support'],
			requiredRuntime: 'nuc',
			position: 'top',
		},
	],
};
