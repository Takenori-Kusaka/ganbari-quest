import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): step 1 は selector 省略で画面中央 modal 表示。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
// #4670 (EPIC #4650): 3 step 固定をやめ、画面の DOM 順に主要操作を網羅する。
//   - 右上リンクは 2 本を包む `report-links` を spotlight (旧: 記録ブックのみ光り、証明書は光らなかった F3)
//   - タブ / 状態で描画が変わる UI (upsell = free のみ / 月の移動 = 月次タブ / メール配信設定 = 週次タブ /
//     きょうだいランキング = プレミアム + ON + 2 人以上) は `optional` で起動時 DOM 判定 (#4668 機構)。
//     タブ依存の step は「そのタブを開いた状態で ❓ を押したとき」に出る。どのタブでも tabs step が
//     週次設定の場所を文言で案内する (網羅を文言でも担保)。
const L = PAGE_GUIDE_LABELS.adminReports;

export const REPORTS_GUIDE: PageGuide = {
	pageId: 'admin-reports',
	title: L.title,
	icon: '📊',
	steps: [
		// ① ページ概要
		{
			id: 'reports-intro',
			...L.steps['reports-intro'],
		},
		// ② 右上の証明書 / 記録ブック リンク (常設)
		{
			id: 'reports-links',
			selector: '[data-tutorial="report-links"]',
			...L.steps['reports-links'],
			position: 'bottom',
		},
		// ③ 無料プラン向け upsell バナー (free のみ)
		{
			id: 'reports-weekly-upsell',
			selector: '[data-tutorial="weekly-report-upsell"]',
			...L.steps['reports-weekly-upsell'],
			optional: true,
			position: 'bottom',
		},
		// ④ 月次 / 週次タブ (常設)
		{
			id: 'reports-tabs',
			selector: '[data-tutorial="report-tabs"]',
			...L.steps['reports-tabs'],
			position: 'bottom',
		},
		// ⑤ 月の移動と先月比 (月次タブ表示中のみ)
		{
			id: 'reports-month-nav',
			selector: '[data-tutorial="report-month-nav"]',
			...L.steps['reports-month-nav'],
			optional: true,
			position: 'bottom',
		},
		// ⑥ 週次メール配信設定 (週次タブ表示中のみ)
		{
			id: 'reports-weekly-settings',
			selector: '[data-tutorial="weekly-report-settings"]',
			...L.steps['reports-weekly-settings'],
			optional: true,
			position: 'bottom',
		},
		// ⑦ きょうだいランキング (プレミアム + 設定 ON + 子 2 人以上のときのみ)
		{
			id: 'reports-sibling-ranking',
			selector: '[data-tutorial="sibling-ranking"]',
			...L.steps['reports-sibling-ranking'],
			optional: true,
			position: 'top',
		},
	],
};
