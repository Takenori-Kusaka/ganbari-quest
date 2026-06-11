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
			how: 'チャレンジを作成し、目標回数と期間を決めて配信します。前の週に取り組めなかったカテゴリを狙ったチャレンジが毎週自動でも提案されます。',
			goal: 'お子さまの画面に進捗バーが表示され、達成に近づく様子が見えます。期間内に達成すると特別な演出でお祝いされます。',
			requiredTier: 'family',
		},
		// ② 最頻操作（チャレンジを作る）
		{
			id: 'challenges-create',
			selector: '[data-tutorial="challenges-create"]',
			title: 'よく使う操作（チャレンジを作る）',
			what: 'ここからチャレンジを 1 つずつ作成します。タイトル・目標回数・期間を決めて、配信するお子さまを選びます。兄弟姉妹を複数選ぶと、みんなで協力して達成を目指す共同チャレンジになります。',
			how: '1. 「チャレンジを作成」をタップ\n2. タイトル・目標回数・期間を設定\n3. 配信するお子さまを選んで作成',
			goal: 'お子さまのチャレンジ一覧に新しい目標が追加され、進捗バーで達成までの道のりが見えるようになります。',
			tips: ['チャレンジは欲張らず1〜2個から始めると、達成体験を積みやすくなります'],
			position: 'bottom',
		},
	],
};
