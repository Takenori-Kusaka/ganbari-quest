import type { TutorialChapter } from './tutorial-types';

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
	{
		id: 1,
		title: 'はじめに',
		icon: '🏠',
		steps: [
			{
				id: 'intro-1',
				chapterId: 1,
				selector: '[data-tutorial="summary-cards"]',
				title: 'ダッシュボード',
				description:
					'ここには、こどもの数やポイントの合計がひと目で分かるカードが表示されています。',
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'intro-2',
				chapterId: 1,
				selector: '[data-tutorial="nav-primary"]',
				title: 'ナビゲーション',
				description:
					'画面下部（PCでは上部）のメニューから各機能にアクセスできます。ホーム・活動・こども・ポイント・設定の5つです。',
				position: 'top',
				page: '/admin',
			},
			{
				id: 'intro-3',
				chapterId: 1,
				selector: '[data-tutorial="quick-actions"]',
				title: 'クイックアクション',
				description:
					'よく使う機能にワンタップでアクセスできるショートカットです。特別報酬の付与やポイント変換がすぐにできます。',
				position: 'top',
				page: '/admin',
			},
		],
	},
	{
		id: 2,
		title: 'こどもの登録',
		icon: '👧',
		steps: [
			{
				id: 'children-1',
				chapterId: 2,
				selector: '[data-tutorial="children-list"]',
				title: 'こども一覧',
				description:
					'登録されているこどもがカード形式で表示されます。カードをタップすると詳細情報が見られます。',
				position: 'bottom',
				page: '/admin/children',
			},
			{
				id: 'children-2',
				chapterId: 2,
				selector: '[data-tutorial="add-child-btn"]',
				title: 'こどもを追加',
				description:
					'ここからこどものアカウントを追加できます。ニックネーム・年齢・テーマカラーを設定しましょう。',
				position: 'bottom',
				page: '/admin/children',
			},
			{
				id: 'children-3',
				chapterId: 2,
				selector: '[data-tutorial="child-card"]',
				title: 'こどもカード',
				description:
					'各こどものカードには名前・年齢・レベル・ポイント残高が表示されます。「編集」で情報を変更できます。',
				position: 'bottom',
				page: '/admin/children',
			},
		],
	},
	{
		id: 3,
		title: '活動の管理',
		icon: '📋',
		steps: [
			{
				id: 'activities-1',
				chapterId: 3,
				selector: '[data-tutorial="activity-list"]',
				title: '活動一覧',
				description: 'こどもが記録できる活動の一覧です。カテゴリごとに分類されています。',
				position: 'bottom',
				page: '/admin/activities',
			},
			{
				id: 'activities-2',
				chapterId: 3,
				selector: '[data-tutorial="add-activity-btn"]',
				title: '活動を追加',
				description:
					'オリジナルの活動を追加できます。活動名・カテゴリ・獲得ポイント・1日の上限回数を設定しましょう。',
				position: 'bottom',
				page: '/admin/activities',
			},
			{
				id: 'activities-3',
				chapterId: 3,
				selector: '[data-tutorial="category-filter"]',
				title: 'カテゴリで絞り込み',
				description:
					'カテゴリボタンで表示する活動を絞り込めます。べんきょう・うんどう・せいかつなどがあります。',
				position: 'bottom',
				page: '/admin/activities',
			},
		],
	},
	{
		id: 4,
		title: '報酬とポイント',
		icon: '🎁',
		steps: [
			{
				id: 'rewards-1',
				chapterId: 4,
				selector: '[data-tutorial="rewards-section"]',
				title: '特別報酬',
				description:
					'頑張ったこどもに特別報酬（ポイント）を付与できます。理由を入力してモチベーションアップ！',
				position: 'bottom',
				page: '/admin/rewards',
			},
			{
				id: 'rewards-2',
				chapterId: 4,
				selector: '[data-tutorial="points-section"]',
				title: 'ポイント管理',
				description:
					'ポイントの確認・交換ができます。設定でポイントをお金（おこづかい）に換算する機能もあります。',
				position: 'bottom',
				page: '/admin/points',
			},
		],
	},
	{
		id: 5,
		title: '毎日の使い方',
		icon: '📅',
		steps: [
			{
				id: 'daily-1',
				chapterId: 5,
				selector: '[data-tutorial="children-overview"]',
				title: 'こどもの様子を確認',
				description:
					'ホームのこども一覧で、レベルやポイント残高をひと目で確認できます。タップすると詳しい情報が見られます。',
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'daily-2',
				chapterId: 5,
				selector: '[data-tutorial="switch-to-child"]',
				title: 'こども画面へ切替',
				description:
					'右上の「子供画面へ」ボタンで、こどもが使う画面に切り替えられます。こどもにタブレットを渡す時に使いましょう。',
				position: 'bottom',
				page: '/admin',
			},
		],
	},
	{
		id: 6,
		title: 'その他の設定',
		icon: '⚙️',
		steps: [
			{
				id: 'settings-1',
				chapterId: 6,
				selector: '[data-tutorial="pin-settings"]',
				title: 'PIN変更',
				description:
					'管理画面にアクセスするためのPINコードを変更できます。セキュリティのため定期的な変更をおすすめします。',
				position: 'bottom',
				page: '/admin/settings',
			},
			{
				id: 'settings-2',
				chapterId: 6,
				selector: '[data-tutorial="feedback-section"]',
				title: 'フィードバック',
				description:
					'機能のリクエストやバグの報告ができます。みなさまの声がアプリの改善に繋がります！',
				position: 'top',
				page: '/admin/settings',
			},
			{
				id: 'settings-3',
				chapterId: 6,
				selector: '[data-tutorial="tutorial-restart"]',
				title: 'チュートリアル',
				description:
					'このチュートリアルは、ヘッダーの「?」ボタンからいつでも再開できます。お疲れさまでした！',
				position: 'bottom',
				page: '/admin/settings',
			},
		],
	},
];

export function getAllSteps() {
	return TUTORIAL_CHAPTERS.flatMap((ch) => ch.steps);
}

export function getTotalStepCount() {
	return getAllSteps().length;
}
