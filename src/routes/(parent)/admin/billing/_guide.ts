import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3267 (EPIC #3260 C3): お支払い（billing）ページガイド。
// narrative 3 部構成（①概要 → ②画面の見方 → ③最頻操作、#2927 / ADR-0012）。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
// billing は runtimeMode 分岐の無い単一ページで、billing-overview / billing-portal の
// アンカーは全環境で常に描画されるため requiredRuntime 制約は不要（#3291 検証済）。
const L = PAGE_GUIDE_LABELS.adminBilling;

export const BILLING_GUIDE: PageGuide = {
	pageId: 'admin-billing',
	title: L.title,
	icon: '🧾',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'billing-intro',
			...L.steps['billing-intro'],
		},
		// ② 画面の見方（ご契約状況）
		{
			id: 'billing-overview',
			selector: '[data-tutorial="billing-overview"]',
			...L.steps['billing-overview'],
			position: 'bottom',
		},
		// ③ 最頻操作（請求管理ページ）
		{
			id: 'billing-portal',
			selector: '[data-tutorial="billing-portal"]',
			...L.steps['billing-portal'],
			position: 'bottom',
		},
	],
};
