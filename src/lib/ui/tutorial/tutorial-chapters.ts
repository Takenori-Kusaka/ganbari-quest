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
				selector: '[data-tutorial="nav-primary"]',
				title: 'ナビゲーション',
				description:
					'まずはメニューの全体像から。ホーム・活動・こども・ポイント・設定の5つのタブで管理画面を操作します。毎日の記録確認から設定変更まで、すべてここから始まります。',
				position: 'top',
				page: '/admin',
			},
			{
				id: 'intro-2',
				chapterId: 1,
				selector: '[data-tutorial="summary-cards"]',
				title: 'ダッシュボード',
				description:
					'こどもの人数やポイント合計がひと目で分かるサマリーです。「今日こどもたちは何ポイント貯めたかな？」を確認したい時にまずここを見てください。',
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'intro-3',
				chapterId: 1,
				selector: '[data-tutorial="quick-actions"]',
				title: 'クイックアクション',
				description:
					'よく使う操作へのショートカットです。「テストで100点だった！」など特別な頑張りにすぐポイントをあげたい時や、おこづかいに交換したい時にここからワンタップで操作できます。',
				position: 'top',
				page: '/admin',
			},
			{
				id: 'intro-4',
				chapterId: 1,
				selector: '[data-tutorial="children-overview"]',
				title: 'こども一覧（ホーム）',
				description:
					'登録したこどもの今の状態（レベル・ポイント）がカードで表示されます。「兄弟それぞれ今どのくらい頑張ってるかな？」をホーム画面から確認できます。',
				position: 'bottom',
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
				selector: '[data-tutorial="add-child-btn"]',
				title: 'こどもを追加',
				description:
					'まだこどもを登録していない場合はここから追加しましょう。ニックネーム・生年月日・テーマカラーを設定すると、こども専用の画面が作られます。兄弟がいれば複数登録できます。',
				position: 'bottom',
				page: '/admin/children',
			},
			{
				id: 'children-2',
				chapterId: 2,
				selector: '[data-tutorial="children-list"]',
				title: 'こども一覧',
				description:
					'登録済みのこどもがカード形式で並びます。「こどもの年齢設定を変更したい」「テーマカラーを変えたい」時は、カードをタップして編集画面へ進みましょう。',
				position: 'bottom',
				page: '/admin/children',
			},
			{
				id: 'children-3',
				chapterId: 2,
				selector: '[data-tutorial="child-card"]',
				title: 'こどもカード',
				description:
					'各こどもの名前・年齢・レベル・ポイント残高が表示されます。「こどもごとの進捗をざっくり把握したい」時にここを見てください。',
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
				selector: '[data-tutorial="category-filter"]',
				title: 'カテゴリで絞り込み',
				description:
					'活動は「うんどう」「べんきょう」「せいかつ」などのカテゴリに分かれています。「うんどう系の活動を見直したい」など、目的に合わせて絞り込めます。',
				position: 'bottom',
				page: '/admin/activities',
			},
			{
				id: 'activities-2',
				chapterId: 3,
				selector: '[data-tutorial="activity-list"]',
				title: '活動一覧',
				description:
					'こどもが記録できる活動の一覧です。各活動の獲得ポイントや1日の上限回数を確認・編集できます。「このポイント多すぎるかな？」と思ったらここで調整しましょう。',
				position: 'bottom',
				page: '/admin/activities',
			},
			{
				id: 'activities-3',
				chapterId: 3,
				selector: '[data-tutorial="add-activity-btn"]',
				title: '活動を追加',
				description:
					'お子さまの習い事や家庭のルールに合わせたオリジナル活動を追加できます。例えば「ピアノの練習30分」「犬のお散歩」など、ご家庭ならではの活動を登録しましょう。\n\n⭐ カスタム活動の追加・編集はスタンダードプラン以上で利用できます。無料プランではプリセット活動をそのままご利用いただけます。',
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
					'「お手伝いを自分から進んでやった」「テストでいい点を取った」など、日常の活動記録とは別に特別なポイントを贈りたい時に使います。理由を添えてポイントを渡しましょう。',
				position: 'bottom',
				page: '/admin/rewards',
			},
			{
				id: 'rewards-2',
				chapterId: 4,
				selector: '[data-tutorial="points-section"]',
				title: 'おこづかい変換',
				description:
					'貯まったポイントをおこづかいに交換する画面です。「500ポイント貯まったからおこづかいにしよう」という時に使います。変換履歴で月の合計額も確認できます。',
				position: 'bottom',
				page: '/admin/points',
			},
		],
	},
	{
		id: 5,
		title: '設定と日常の使い方',
		icon: '⚙️',
		steps: [
			{
				id: 'settings-1',
				chapterId: 5,
				selector: '[data-tutorial="switch-to-child"]',
				title: 'こども画面へ切替',
				description:
					'こどもにタブレットやスマホを渡す時に使います。こども専用のゲーム画面に切り替わり、自分で活動を記録できるようになります。管理画面に戻るにはPINコードが必要です。',
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'settings-2',
				chapterId: 5,
				selector: '[data-tutorial="pin-settings"]',
				title: 'PINコード設定',
				description:
					'管理画面へのアクセスを保護するPINコードを変更できます。こどもに勝手にポイントを変えられないよう、定期的に変更するのがおすすめです。',
				position: 'bottom',
				page: '/admin/settings',
			},
			{
				id: 'settings-3',
				chapterId: 5,
				selector: '[data-tutorial="feedback-section"]',
				title: 'フィードバック',
				description:
					'「こんな機能がほしい」「ここが使いにくい」など、何でもお聞かせください。いただいた声をもとにアプリを改善していきます。',
				position: 'top',
				page: '/admin/settings',
			},
			{
				id: 'settings-4',
				chapterId: 5,
				selector: '[data-tutorial="tutorial-restart"]',
				title: 'チュートリアルの再開',
				description:
					'このチュートリアルは、ヘッダーの「？」ボタンからいつでも見直せます。使い方に迷った時はお気軽にどうぞ。お疲れさまでした！',
				position: 'bottom',
				page: '/admin/settings',
			},
		],
	},
	{
		id: 6,
		title: 'プレミアム機能',
		icon: '⭐',
		steps: [
			{
				id: 'premium-1',
				chapterId: 6,
				title: '無料でできること',
				description:
					'プリセット活動の記録、子供1人の登録、ゲーミフィケーション機能（レベル・ポイント・実績・称号）は無料でお使いいただけます。まずは無料で試してみてください！',
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'premium-2',
				chapterId: 6,
				title: 'プレミアムでできること',
				description:
					'オリジナル活動の追加・編集、チェックリストの自由作成、ごほうびの設定、子供の登録無制限、データのエクスポートが可能になります。お子さまに合わせたカスタマイズで、もっと楽しく！',
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'premium-3',
				chapterId: 6,
				selector: '[data-tutorial="upgrade-btn"]',
				title: 'アップグレード',
				description:
					'管理画面右上の「⭐ アップグレード」ボタンから、いつでも有料プランに切り替えられます。7日間の無料トライアル付きなので、まずはお試しください。',
				position: 'bottom',
				page: '/admin',
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
