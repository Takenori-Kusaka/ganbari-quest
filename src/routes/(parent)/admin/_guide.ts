/**
 * 管理画面ホーム — ページガイド定義
 *
 * 【設計意図】
 * 本ガイドは「ユーザーマニュアルを別途用意しない」という
 * プロダクト判断を可能にする唯一の手段である。
 *
 * 各ステップは三部構成（what/how/goal）を必ず満たすこと。
 * 「これは○○です」という浅い説明は禁止。
 */

import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

export const ADMIN_HOME_GUIDE: PageGuide = {
	pageId: 'admin-home',
	title: 'ホーム（ダッシュボード）',
	icon: '🏠',
	steps: [
		{
			id: 'home-summary',
			selector: '[data-tutorial="summary-cards"]',
			title: '今日のサマリー',
			what: 'お子さま全員の今日のがんばりを、数字でひと目で確認できます。活動回数・獲得ポイント・レベルの概要が表示されます。',
			how: '特に操作は不要です。ページを開くと自動的に最新の情報が表示されます。',
			goal: '毎日の確認が10秒で済むので、お子さまのがんばりを見逃しません。「今日はたくさんやったね！」と声をかけるタイミングがわかります。',
			position: 'bottom',
		},
		{
			id: 'home-children-overview',
			selector: '[data-tutorial="children-overview"]',
			title: 'お子さま一覧',
			what: '登録しているお子さまのカードが並びます。名前・年齢・レベル・今月の活動数が表示され、カードをタップすると詳しい情報が見られます。',
			how: '1. お子さまのカードをタップします\n2. 「こども管理」画面に移動して詳細を確認できます',
			goal: 'お子さまが複数いる場合でも、それぞれの進捗を比較しながら把握できます。',
			position: 'bottom',
		},
		{
			id: 'home-nav',
			selector: '[data-tutorial="nav-primary"]',
			title: 'ナビゲーション',
			what: '画面下部のナビゲーションから各機能に移動できます。「みまもり」「やること」「はげまし」「きろく」の4つのカテゴリで構成されています。',
			how: '1. 画面下部のアイコンをタップします\n2. 目的の機能のカテゴリを選びます\n3. サブメニューが開くので、該当する画面をタップします',
			goal: 'どの画面からでも2タップ以内で目的の機能にたどり着けます。',
			tips: ['デスクトップ版ではヘッダー部分のドロップダウンメニューから同じ機能に移動できます'],
			position: 'top',
		},
	],
};
