// #3267 (EPIC #3260 C3): プラン・課金（subscription）ページガイド。
// narrative 3 部構成（①概要 → ②画面の見方 → ③最頻操作、#2927 / ADR-0012）。
// 文言は SSOT（terms.ts）を参照し guide-copy-rules.md に準拠（check-guide-copy.ts 検査）。
import {
	CANCEL_TERMS,
	PLAN_CHANGE_TERMS,
	STRIPE_PORTAL_TERMS,
	UPGRADE_TERMS,
} from '$lib/domain/terms';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

export const SUBSCRIPTION_GUIDE: PageGuide = {
	pageId: 'admin-subscription',
	title: 'プラン・課金',
	icon: '💳',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'subscription-intro',
			title: 'このページについて',
			what: `現在のプランの確認と、${UPGRADE_TERMS.canonical}・${STRIPE_PORTAL_TERMS.short}をまとめたページです。`,
			how: '上から「現在のプラン」「プラン管理」「支払い履歴」の順に並びます。',
			goal: `プランの状況をひと目で把握し、${PLAN_CHANGE_TERMS.changeNoun}や支払いの管理を迷わず行えます。`,
		},
		// ② 画面の見方（現在のプラン）
		{
			id: 'subscription-current-plan',
			selector: '[data-tutorial="subscription-current-plan"]',
			title: '画面の見方（現在のプラン）',
			what: 'いま契約中のプランと、無料トライアル中ならその残り期間がここに表示されます。',
			how: '1. 上部で現在のプランを確認します\n2. 下の「プラン管理」で変更できます',
			goal: '今どのプランかをすぐ確認でき、変更前の状態を把握できます。',
			position: 'bottom',
		},
		// ③ 最頻操作（プラン管理）
		{
			id: 'subscription-plan-management',
			selector: '[data-tutorial="subscription-plan-management"]',
			title: `よく使う操作（${PLAN_CHANGE_TERMS.changeNoun}）`,
			what: `プランの選択・変更と、${STRIPE_PORTAL_TERMS.canonical}への移動をここから行います。`,
			how: `1. 変更したいプランを選びます\n2. 確認のうえ${STRIPE_PORTAL_TERMS.short}で手続きします`,
			goal: `${PLAN_CHANGE_TERMS.changeNoun}が反映され、支払い方法も${STRIPE_PORTAL_TERMS.short}で管理できます。`,
			tips: [`${CANCEL_TERMS.anytime}できます`],
			position: 'bottom',
		},
	],
};
