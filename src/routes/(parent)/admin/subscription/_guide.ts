import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3267 (EPIC #3260 C3): プラン・課金（subscription）ページガイド。
// narrative 3 部構成（①概要 → ②画面の見方 → ③最頻操作、#2927 / ADR-0012）。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
// #3291: SaaS step ②③ は SaasLicensePanel 専用 UI を指すため requiredRuntime='saas'。NUC 版
//        (NucLicensePanel) には現在のプラン / プラン管理セクションが無く、selector 未解決 →
//        空 spotlight + 実装にない操作案内になるため nuc-prod では除外する（ADR-0013 truth）。
// #3296: (1) SaaS step③ は SaasLicensePanel の `{#if stripeEnabled}` ブロック内 UI を指すため
//        requiredStripe='enabled' を併記し、Stripe 無効な local-debug/demo の空 spotlight も塞ぐ
//        （runtimeMode 軸と直交、ADR-0061 same-class）。(2) NUC では intro のみで操作 spotlight が
//        ゼロだったため、NucLicensePanel の Edition badge / 利用状況を spotlight する NUC 専用 step
//        を requiredRuntime='nuc' で追加する（filterGuideStepsByRuntime が環境別に出し分ける）。
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
		// ② 画面の見方（現在のプラン）— SaaS 版のみ
		{
			id: 'subscription-current-plan',
			selector: '[data-tutorial="subscription-current-plan"]',
			...L.steps['subscription-current-plan'],
			requiredRuntime: 'saas',
			position: 'bottom',
		},
		// ③ 最頻操作（プラン管理）— SaaS 版 + Stripe 有効時のみ（#3296）
		{
			id: 'subscription-plan-management',
			selector: '[data-tutorial="subscription-plan-management"]',
			...L.steps['subscription-plan-management'],
			requiredRuntime: 'saas',
			requiredStripe: 'enabled',
			position: 'bottom',
		},
		// ②' 画面の見方（ご利用中の版）— NUC 版のみ（#3296）
		{
			id: 'subscription-nuc-edition',
			selector: '[data-tutorial="nuc-edition"]',
			...L.steps['subscription-nuc-edition'],
			requiredRuntime: 'nuc',
			position: 'bottom',
		},
		// ③' 画面の見方（利用状況）— NUC 版のみ（#3296）
		{
			id: 'subscription-nuc-usage',
			selector: '[data-tutorial="nuc-usage"]',
			...L.steps['subscription-nuc-usage'],
			requiredRuntime: 'nuc',
			position: 'bottom',
		},
	],
};
