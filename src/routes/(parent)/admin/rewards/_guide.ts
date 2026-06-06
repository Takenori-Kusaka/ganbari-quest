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
		// ③ 最頻操作（ごほうび追加の起点 = 追加ボタンを target にする）
		{
			id: 'rewards-add',
			// 追加フォームの「追加する」ボタン (Card 末尾の主 CTA) を highlight する。
			// position hint は撤去して driver.js collision-aware auto 配置に委譲する (#2968 round2)。
			// per-step 手書き hint は driver.js auto と競合して一方の viewport で overflow を引き起こす
			// (mobile を直して desktop を壊す whack-a-mole)。auto 配置が bottom → top flip を viewport
			// 状況に応じて選択することで全 viewport PASS が保証される。
			selector: '[data-tutorial="rewards-add-start"]',
			title: 'よく使う操作（ごほうびの追加）',
			what: '最もよく使うのがごほうびの追加です。テンプレートから選ぶか、下の作成フォームでタイトル・ポイント・アイコンを決めてオリジナルを作成します。',
			how: '1. テンプレートから選ぶか、オリジナルのごほうびを作成\n2. タイトル・ポイント・アイコンを設定\n3. 「追加する」をタップ',
			goal: '子供のごほうびショップにごほうびが並び、お子さまが貯めたポイントで交換できるようになります。',
			tips: ['ポイントは通常の活動の10〜50回分くらいが目安です（多すぎるとインフレします）'],
		},
	],
};
