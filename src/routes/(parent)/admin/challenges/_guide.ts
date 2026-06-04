import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2905: チャレンジ管理ページの ❓ ガイド。
// #2294 EPIC で challenges ページが新設された際に page-guide-registry へ未登録のままだったため
// ❓ ボタンが表示されず「ページガイドが見当たらない」状態になっていた (PO 指摘 #8) のを復旧する。
export const CHALLENGES_GUIDE: PageGuide = {
	pageId: 'admin-challenges',
	title: 'チャレンジ管理',
	icon: '🏆',
	steps: [
		{
			id: 'challenges-overview',
			selector: '[data-tutorial="challenges-page"]',
			title: 'チャレンジとは',
			what: '「1週間で運動を5回」「今月は読書を10冊」のような、期間つきの目標をお子さまに設定できます。日々の活動記録とは別に「中期的なゴール」を持たせることで、達成感と継続意欲を高めます。',
			how: '1. 「チャレンジを作成」をタップ\n2. タイトル・目標回数・期間を設定します\n3. 配信するお子さまを選んで作成します',
			goal: 'お子さまの画面にチャレンジの進捗バーが表示され、達成に近づく様子が見えます。期間内に達成すると特別な達成演出でお祝いされます。',
			requiredTier: 'family',
			position: 'bottom',
		},
		{
			id: 'challenges-marketplace',
			selector: '[data-tutorial="challenges-marketplace"]',
			title: 'みんなのテンプレートから取り込む',
			what: '季節の行事や定番の目標（夏休みチャレンジ・お手伝い強化週間 など）をみんなのテンプレートから取り込めます。',
			how: '1. 「📦 みんなのテンプレートを見る」をタップ\n2. マーケットプレイスでチャレンジ集を選びます\n3. 「使ってみる」から取り込み、配信するお子さまを選びます',
			goal: '選んだチャレンジ集がお子さまのチャレンジ一覧にまとめて追加されます。ご家庭の方針に合わせて取捨選択できます。',
			tips: ['チャレンジは欲張らず1〜2個から始めると、達成体験を積みやすくなります'],
			position: 'bottom',
		},
	],
};
