import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// 旧構成 (フィルタ説明から開始) を是正し、step 1 は selector 省略で画面中央 modal 表示。
export const ACTIVITIES_GUIDE: PageGuide = {
	pageId: 'admin-activities',
	title: '活動管理',
	icon: '📋',
	steps: [
		// ① ページ概要
		{
			id: 'activities-intro',
			title: 'このページについて',
			what: 'お子さまが記録する「活動」を管理するページです。習い事・お手伝い・家庭ルールなど、ご家庭オリジナルのがんばりをポイント化できます。',
			how: '初期登録の活動に加えて、独自の活動を追加・編集できます。設定した活動はお子さまの画面にカードとして並びます。',
			goal: 'お子さまがタップして記録するたびにポイントが貯まり、「今月ピアノを何回練習したか」までレポートで見えるようになります。',
		},
		// ② 画面の見方
		{
			id: 'activities-filter',
			selector: '[data-tutorial="category-filter"]',
			title: '画面の見方（カテゴリで絞り込み）',
			what: '活動は5つのカテゴリ（うんどう・べんきょう・せいかつ・おてつだい・そうぞう）に分かれています。上部のフィルターで表示を絞り込めます。',
			how: '1. カテゴリボタンをタップして絞り込みます\n2. もう一度タップすると解除されます',
			goal: '活動が増えても「うんどう系だけ表示」のように、目的の活動を素早く見つけられます。',
			position: 'bottom',
		},
		// ③ 最頻操作
		{
			id: 'activities-add',
			selector: '[data-tutorial="add-activity-btn"]',
			title: 'よく使う操作（活動の追加）',
			what: '最もよく使うのが活動の追加です。「＋ 追加」メニューから手動作成・AI 提案・みんなのテンプレートからの取り込みを選べます。',
			how: '1. 「＋ 追加」ボタンをタップ\n2. 追加方法を選びます\n3. 活動名・カテゴリ・アイコン・ポイント・1日の上限回数を設定\n4. 「保存」をタップ',
			goal: 'お子さまの画面に新しい活動カードが表示され、記録するとポイントが貯まり、月次レポートにも反映されます。',
			tips: [
				'ポイントは初期活動とのバランスを見て設定しましょう（高すぎるとインフレします）',
				'1日上限回数を設定すると、連打によるスパムを防げます',
			],
			requiredTier: 'standard',
			position: 'bottom',
		},
	],
};
