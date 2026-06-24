import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3267 (EPIC #3260 C3): プラン・課金（subscription）ページガイド。
// narrative 3 部構成（①概要 → ②画面の見方 → ③最頻操作、#2927 / ADR-0012）。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
// #3291: step ②③ は SaaS 版 (SaasLicensePanel) 専用 UI を指すため requiredRuntime='saas'。
//        NUC 版 (NucLicensePanel) には現在のプラン / プラン管理セクションが無く、selector
//        未解決 → 空 spotlight + 実装にない操作案内になるため、nuc-prod では本 2 step を除外
//        する（filterGuideStepsByRuntime、ADR-0013 truth）。intro は両環境で正しい内容に留める。
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
		// ③ 最頻操作（プラン管理）— SaaS 版のみ
		{
			id: 'subscription-plan-management',
			selector: '[data-tutorial="subscription-plan-management"]',
			...L.steps['subscription-plan-management'],
			requiredRuntime: 'saas',
			position: 'bottom',
		},
	],
};
