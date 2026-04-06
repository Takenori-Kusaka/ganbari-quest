import { NAV_CATEGORIES, NAV_ITEM_LABELS, PLAN_LABELS } from '$lib/domain/labels';
import type { PlanTier, TutorialChapter } from './tutorial-types';

const TIER_ORDER: Record<PlanTier, number> = { free: 0, standard: 1, family: 2 };

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
	{
		id: 1,
		title: 'はじめに',
		icon: '🏠',
		steps: [
			{
				id: 'intro-1',
				chapterId: 1,
				selector: '[data-tutorial="nav-desktop"], [data-tutorial="nav-primary"]',
				title: 'ナビゲーション',
				description: `メニューは「${NAV_CATEGORIES.monitor.label}」「${NAV_CATEGORIES.encourage.label}」「${NAV_CATEGORIES.customize.label}」「${NAV_CATEGORIES.settings.label}」の4つのカテゴリに分かれています。それぞれのカテゴリを開くと、詳しいメニューが表示されます。`,
				position: 'top',
				page: '/admin',
			},
			{
				id: 'intro-2',
				chapterId: 1,
				selector: '[data-tutorial="summary-cards"]',
				title: 'ダッシュボード',
				description:
					'こどもの人数やポイントの合計がひと目で分かるサマリーです。「今こどもたちは合計何ポイント持っているかな？」を確認したい時にまずここを見てください。',
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'intro-3',
				chapterId: 1,
				selector: '[data-tutorial="monthly-summary"]',
				title: '今月のがんばり',
				description:
					'こどもごとの今月の活動回数・レベル・実績がひと目で分かるサマリーです。「今月はどのくらい頑張ったかな？」を毎日チェックしてみましょう。詳しくはレポート画面で確認できます。',
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'intro-4',
				chapterId: 1,
				selector: '[data-tutorial="children-overview"]',
				title: 'こども一覧（ホーム）',
				description:
					'登録したこどもの名前・年齢・ポイント残高が表示されます。「きょうだいそれぞれ今どのくらい頑張ってるかな？」をホーム画面から確認できます。',
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
					'まだこどもを登録していない場合はここから追加しましょう。ニックネーム・生年月日・テーマカラーを設定すると、こども専用の画面が作られます。きょうだいがいれば複数登録できます。',
				position: 'bottom',
				page: '/admin/children',
			},
			{
				id: 'children-2',
				chapterId: 2,
				selector: '[data-tutorial="children-list"]',
				title: 'こども一覧',
				description:
					'登録済みのこどもが一覧で並びます。「こどもの年齢設定を変更したい」「テーマカラーを変えたい」時は、名前をタップして編集画面へ進みましょう。',
				position: 'bottom',
				page: '/admin/children',
			},
			{
				id: 'children-3',
				chapterId: 2,
				selector: '[data-tutorial="child-card"]',
				title: 'こどもの詳細',
				description:
					'各こどもの名前・年齢・ポイント残高が表示されます。「こどもごとの進捗をざっくり把握したい」時にここを見てください。\n\n⭐ 無料プランではこどもを2人まで登録できます。3人以上のきょうだいがいる場合はスタンダードプラン以上で無制限に登録できます。',
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
				description:
					'こどもが記録できる活動の一覧です。各活動の獲得ポイントや1日の上限回数を確認・編集できます。「このポイント多すぎるかな？」と思ったらここで調整しましょう。',
				position: 'bottom',
				page: '/admin/activities',
			},
			{
				id: 'activities-2',
				chapterId: 3,
				selector: '[data-tutorial="category-filter"]',
				title: 'カテゴリで絞り込み',
				description:
					'活動は「うんどう」「べんきょう」「せいかつ」などのカテゴリに分かれています。「うんどう系の活動を見直したい」など、目的に合わせて絞り込めます。',
				position: 'bottom',
				page: '/admin/activities',
			},
			{
				id: 'activities-3',
				chapterId: 3,
				selector: '[data-tutorial="add-activity-btn"]',
				title: '活動の追加',
				description: `お子さまの習い事や家庭のルールに合わせたオリジナル活動を追加できます。例えば「ピアノの練習30分」「犬のお散歩」など、ご家庭ならではの活動を登録しましょう。\n\n⭐ 活動の追加・編集は${PLAN_LABELS.standard}以上で利用できます。${PLAN_LABELS.free}では初期登録されている活動をそのままご利用いただけます。`,
				position: 'bottom',
				page: '/admin/activities',
				requiredTier: 'standard',
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
					'「お手伝いを自分から進んでやった」「テストでいい点を取った」など、日常の活動記録とは別に特別なポイントを贈りたい時に使います。理由を添えてポイントを渡しましょう。\n\n⭐ ごほうびアイテムの設定はスタンダードプラン以上で利用できます。',
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
				position: 'top',
				page: '/admin/points',
			},
		],
	},
	{
		id: 5,
		title: `${NAV_CATEGORIES.monitor.label}（${NAV_ITEM_LABELS.reports}）`,
		icon: '📊',
		steps: [
			{
				id: 'reports-1',
				chapterId: 5,
				selector: '[data-tutorial="report-tabs"]',
				title: 'レポート画面',
				description:
					'こどもの活動を月次・週次で振り返れるレポート画面です。上部のタブで「月次レポート」と「週次レポート」を切り替えられます。「今月はどんな活動が多かったかな？」を確認しましょう。',
				position: 'bottom',
				page: '/admin/reports',
			},
			{
				id: 'reports-2',
				chapterId: 5,
				selector: '[data-tutorial="growth-book-link"]',
				title: 'グロースブック',
				description:
					'こどもの1年間の成長をまとめた「成長記録ブック」も用意しています。レポート画面右上の「📖 記録ブック」リンクからアクセスできます。印刷してお子さまの記念にもなります。',
				position: 'bottom',
				page: '/admin/reports',
			},
		],
	},
	{
		id: 6,
		title: `${NAV_CATEGORIES.encourage.label}（${NAV_ITEM_LABELS.messages}）`,
		icon: '💬',
		steps: [
			{
				id: 'messages-1',
				chapterId: 6,
				selector: '[data-tutorial="message-child-select"]',
				title: 'メッセージ送信',
				description:
					'こどもにおうえんメッセージを送れる画面です。まず送りたいこどもを選んで、スタンプまたはテキストメッセージを選びましょう。こどもの画面にメッセージが届きます。',
				position: 'bottom',
				page: '/admin/messages',
			},
			{
				id: 'messages-2',
				chapterId: 6,
				selector: '[data-tutorial="message-stamp-grid"]',
				title: 'スタンプの送り方',
				description:
					'スタンプを選択して「送信」ボタンを押すだけで、こどもにおうえんの気持ちを伝えられます。「がんばったね！」「すごい！」など、お子さまが喜ぶスタンプが揃っています。',
				position: 'bottom',
				page: '/admin/messages',
			},
		],
	},
	{
		id: 7,
		title: `${NAV_CATEGORIES.customize.label}（データ管理）`,
		icon: '🎮',
		steps: [
			{
				id: 'customize-1',
				chapterId: 7,
				selector: '[data-tutorial="data-management"]',
				title: 'データ管理',
				description:
					'家族のデータをJSONファイルとしてエクスポート（バックアップ）したり、別の環境からインポート（復元）できます。機種変更やデータの引っ越しに便利です。',
				position: 'bottom',
				page: '/admin/settings',
				requiredTier: 'standard',
			},
		],
	},
	{
		id: 8,
		title: '設定と日常の使い方',
		icon: '⚙️',
		steps: [
			{
				id: 'settings-1',
				chapterId: 8,
				selector: '[data-tutorial="switch-to-child"]',
				title: 'こども画面へ切替',
				description:
					'こどもにタブレットやスマホを渡す時に使います。こども専用のゲーム画面に切り替わり、自分で活動を記録できるようになります。管理画面に戻るにはPINコードが必要です。\n\n💡 こども画面にも「❓」ボタンからアクセスできる操作ガイドがあります。お子さまが自分で使い方を確認できるので安心です。',
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'settings-2',
				chapterId: 8,
				selector: '[data-tutorial="pin-settings"]',
				title: 'PINコード設定',
				description:
					'管理画面へのアクセスを保護するPINコードを変更できます。こどもに勝手にポイントを変えられないよう、定期的に変更するのがおすすめです。',
				position: 'bottom',
				page: '/admin/settings',
			},
			{
				id: 'settings-3',
				chapterId: 8,
				selector: '[data-tutorial="feedback-section"]',
				title: 'フィードバック',
				description:
					'「こんな機能がほしい」「ここが使いにくい」など、何でもお聞かせください。いただいた声をもとにアプリを改善していきます。',
				position: 'top',
				page: '/admin/settings',
			},
			{
				id: 'settings-4',
				chapterId: 8,
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
		id: 9,
		title: 'アップグレード',
		icon: '⭐',
		steps: [
			{
				id: 'premium-1',
				chapterId: 9,
				selector: '[data-tutorial="upgrade-btn"]',
				title: 'プラン比較・アップグレード',
				description:
					'各機能のガイドで ⭐ マークが付いた機能はスタンダードプラン以上で利用できます。「⭐ アップグレード」ボタンからプラン比較ページへ進み、お子さまに最適なプランをお選びください。7日間の無料トライアル付きです。',
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

/** プランティアに応じてフィルタされたチャプターを返す */
export function getChaptersForPlan(planTier: PlanTier): TutorialChapter[] {
	return TUTORIAL_CHAPTERS.map((ch) => ({
		...ch,
		steps: ch.steps.filter((step) => {
			if (!step.requiredTier) return true;
			return TIER_ORDER[planTier] >= TIER_ORDER[step.requiredTier];
		}),
	})).filter((ch) => ch.steps.length > 0);
}

/** プランティアに応じてフィルタされた全ステップを返す */
export function getStepsForPlan(planTier: PlanTier) {
	return getChaptersForPlan(planTier).flatMap((ch) => ch.steps);
}
