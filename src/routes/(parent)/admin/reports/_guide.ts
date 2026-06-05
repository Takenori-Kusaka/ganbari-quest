import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。
export const REPORTS_GUIDE: PageGuide = {
	pageId: 'admin-reports',
	title: 'レポート',
	icon: '📊',
	steps: [
		// ① ページ概要
		{
			id: 'reports-intro',
			title: 'このページについて',
			what: 'お子さまのがんばりを、月ごと・週ごとにまとめて振り返るページです。活動回数・レベルアップ・前の期間との比較がひと目でわかります。',
			how: '「月次」「週次」のタブを切り替えて、見たい期間のレポートを表示します。',
			goal: '「今月はうんどうを20回頑張ったね！先月より5回多いよ」と、具体的な数字でお子さまを褒められます。',
		},
		// ② 画面の見方
		{
			id: 'reports-tabs',
			selector: '[data-tutorial="report-tabs"]',
			title: '画面の見方（月次／週次の切り替え）',
			what: 'タブで「月次」と「週次」を切り替えます。月次は1ヶ月の総まとめ、週次は曜日別・カテゴリ別の傾向が見られます。',
			how: '1. 「月次」「週次」タブをタップして切り替えます\n2. 月次は ◀ ▶ で月を移動できます\n3. 前の期間との差分が色付きで表示されます（赤=減少、緑=増加）',
			goal: '「平日は頑張っているけど土日が少ない」のような傾向に気づけ、次の声かけのヒントになります。',
			position: 'bottom',
		},
		// ③ 最頻操作
		{
			id: 'reports-growth-book',
			selector: '[data-tutorial="growth-book-link"]',
			title: 'よく使う操作（賞状・成長ブック）',
			what: 'レポートから、お子さまの頑張りを「修了証（賞状）」として印刷したり、長期的な成長を「成長ブック」で振り返ったりできます。',
			how: '1. このリンクから賞状・成長ブックのページを開きます\n2. 印刷・保存して、お子さまと一緒に振り返ります',
			goal: 'がんばりを形に残せるので、お子さまの達成感が大きくなり、次の目標への意欲につながります。',
			position: 'bottom',
		},
	],
};
