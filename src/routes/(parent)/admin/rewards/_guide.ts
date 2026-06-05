import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。step 2 はお子さまタブ (小要素) を target にする
// (旧 step 1 の rewards-section は巨大要素のため target にしない)。
export const REWARDS_GUIDE: PageGuide = {
	pageId: 'admin-rewards',
	title: 'はげまし・ごほうび',
	icon: '🎁',
	steps: [
		// ① ページ概要
		{
			id: 'rewards-intro',
			title: 'このページについて',
			what: 'お子さまを応援する「ごほうび」を管理するページです。子供のごほうびショップに並べるプレゼント（おこづかい・ゲーム時間・おやつなど）を用意できます。',
			how: 'プリセットから選ぶか、オリジナルのごほうびを作成して、お子さまごとに配信します。その場でひと押ししたい応援は応援ページをご利用ください。',
			goal: 'お子さまが貯めたポイントでごほうびと交換できるようになり、「がんばれば叶う」体験がモチベーションを支えます。',
		},
		// ② 画面の見方
		{
			id: 'rewards-child-tabs',
			selector: '[data-tutorial="rewards-child-tabs"]',
			title: '画面の見方（お子さまの切り替え）',
			what: '上部のタブで、ごほうびを管理するお子さまを切り替えます。タブの数字はそのお子さまに登録済みのごほうび数です。',
			how: '1. お子さまのタブをタップして選びます\n2. その下に、選んだお子さまのごほうび一覧が表示されます',
			goal: 'お子さまごとに別々のごほうびを用意できるので、年齢や興味に合わせた応援ができます。',
			position: 'bottom',
		},
		// ③ 最頻操作
		{
			id: 'rewards-add',
			selector: '[data-tutorial="rewards-add"]',
			title: 'よく使う操作（ごほうびの追加）',
			what: '最もよく使うのがごほうびの追加です。プリセットから選ぶか、タイトル・ポイント・アイコンを決めてオリジナルを作成します。',
			how: '1. プリセットから選ぶか、オリジナルのごほうびを作成\n2. タイトル・ポイント・アイコンを設定\n3. 「追加する」をタップ',
			goal: '子供のごほうびショップにごほうびが並び、お子さまが貯めたポイントで交換できるようになります。',
			tips: ['ポイントは通常の活動の10〜50回分くらいが目安です（多すぎるとインフレします）'],
			position: 'bottom',
		},
	],
};
