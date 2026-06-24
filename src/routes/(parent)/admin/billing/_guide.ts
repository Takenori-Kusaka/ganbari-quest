// #3267 (EPIC #3260 C3): お支払い（billing）ページガイド。
// narrative 3 部構成（①概要 → ②画面の見方 → ③最頻操作、#2927 / ADR-0012）。
// 文言は SSOT（terms.ts）を参照し guide-copy-rules.md に準拠（check-guide-copy.ts 検査）。
import { CANCEL_TERMS, STRIPE_PORTAL_TERMS } from '$lib/domain/terms';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

export const BILLING_GUIDE: PageGuide = {
	pageId: 'admin-billing',
	title: 'お支払い',
	icon: '🧾',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'billing-intro',
			title: 'このページについて',
			what: `ご契約の状況確認と、${STRIPE_PORTAL_TERMS.short}・${CANCEL_TERMS.canonical}をまとめたページです。`,
			how: '上から「ご契約状況」「請求管理」の順に並びます。',
			goal: `支払い状況を把握し、必要なら${STRIPE_PORTAL_TERMS.short}や${CANCEL_TERMS.canonicalVerb}手続きに進めます。`,
		},
		// ② 画面の見方（ご契約状況）
		{
			id: 'billing-overview',
			selector: '[data-tutorial="billing-overview"]',
			title: '画面の見方（ご契約状況）',
			what: '契約中のプランと、次回の請求予定がここに表示されます。',
			how: '1. 契約状況を確認します\n2. 下の「請求管理」で支払い方法を変えられます',
			goal: '今の契約と請求予定をひと目で確認できます。',
			position: 'bottom',
		},
		// ③ 最頻操作（請求管理ページ）
		{
			id: 'billing-portal',
			selector: '[data-tutorial="billing-portal"]',
			title: `よく使う操作（${STRIPE_PORTAL_TERMS.short}）`,
			what: `支払い方法の変更や領収書の確認は${STRIPE_PORTAL_TERMS.canonical}から行います。`,
			how: `1. ${STRIPE_PORTAL_TERMS.short}を開きます\n2. 支払い方法や${CANCEL_TERMS.canonical}を手続きします`,
			goal: `支払い方法を最新に保て、${CANCEL_TERMS.anytime}できます。`,
			position: 'bottom',
		},
	],
};
