import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。巨大要素 (challenges-page) は target にしない。
export const CHALLENGES_GUIDE: PageGuide = {
	pageId: 'admin-challenges',
	title: 'チャレンジ管理',
	icon: '🏆',
	steps: [
		// ① ページ概要
		{
			id: 'challenges-intro',
			title: 'このページについて',
			what: '「1週間で運動を5回」「今月は読書を10冊」のような、期間つきの目標をお子さまに設定するページです。日々の活動とは別に「中期的なゴール」を持たせられます。',
			how: 'チャレンジを作成し、目標回数と期間を決めて配信します。みんなのテンプレートから季節の行事をまとめて取り込むこともできます。',
			goal: 'お子さまの画面に進捗バーが表示され、達成に近づく様子が見えます。期間内に達成すると特別な演出でお祝いされます。',
			requiredTier: 'family',
		},
		// ② 画面の見方
		{
			id: 'challenges-create',
			selector: '[data-tutorial="challenges-create"]',
			title: '画面の見方（チャレンジを作る）',
			what: 'ここからチャレンジを 1 つずつ作成します。タイトル・目標回数・期間を決めて、配信するお子さまを選びます。',
			how: '1. 「チャレンジを作成」をタップ\n2. タイトル・目標回数・期間を設定\n3. 配信するお子さまを選んで作成',
			goal: 'お子さまのチャレンジ一覧に新しい目標が追加され、進捗バーで達成までの道のりが見えるようになります。',
			position: 'bottom',
		},
		// ③ 最頻操作
		{
			id: 'challenges-marketplace',
			selector: '[data-tutorial="challenges-marketplace"]',
			title: 'よく使う操作（テンプレートから取り込む）',
			what: '手軽なのが、みんなのテンプレートからの取り込みです。夏休みチャレンジ・お手伝い強化週間などの定番の目標をまとめて使えます。',
			how: '1. 「みんなのテンプレートを見る」をタップ\n2. マーケットプレイスでチャレンジ集を選びます\n3. 「使ってみる」から取り込み、配信するお子さまを選びます',
			goal: '選んだチャレンジ集がお子さまのチャレンジ一覧にまとめて追加されます。ご家庭の方針に合わせて取捨選択できます。',
			tips: ['チャレンジは欲張らず1〜2個から始めると、達成体験を積みやすくなります'],
			position: 'bottom',
		},
	],
};
