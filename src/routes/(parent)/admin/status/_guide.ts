import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): step 1 は selector 省略で画面中央 modal 表示。
// 巨大要素 (status-report / status-radar = 280px チャート) は driver.js が非重複でバブルを置けないため
// target にせず、チャート直下の注記 (小要素) を target にする。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
// #4669 (EPIC #4650): 3 step 固定をやめ、画面の DOM 順に主要操作を網羅する。
//   - お子さま切替タブ (全保護者に開放、F2) / 右上の編集リンク (F8) / 先月からの変化 (F4) /
//     レベル称号カスタマイズ (F3) / ベンチマーク編集 (ops・NUC のみ、F9) を step 化
//   - 子供の有無 (タブ / チャート / サマリー / 変化 / 0 人時の登録案内) と先月データの有無 (変化) と
//     権限 (ベンチマーク編集) で描画が変わる UI は `optional` で起動時 DOM 判定 (#4668 機構)。
//     子供 0 人の家庭では概要 + 登録案内 + レベル称号 だけが残り、存在しない要素を指す step が出ない (F1)
const L = PAGE_GUIDE_LABELS.adminStatus;

export const STATUS_GUIDE: PageGuide = {
	pageId: 'admin-status',
	title: L.title,
	icon: '📊',
	steps: [
		// ① ページ概要
		{
			id: 'status-intro',
			...L.steps['status-intro'],
		},
		// ② お子さまを選ぶタブ (子供 1 人以上で描画)
		{
			id: 'status-child-tabs',
			selector: '[data-tutorial="status-child-tabs"]',
			...L.steps['status-child-tabs'],
			optional: true,
			position: 'bottom',
		},
		// ②' 子供 0 人時の登録案内 (0 人のときだけ描画)
		{
			id: 'status-empty',
			selector: '[data-tutorial="status-empty"]',
			...L.steps['status-empty'],
			optional: true,
			position: 'bottom',
		},
		// ③ 右上「こども管理でステータス編集 →」(常設)
		{
			id: 'status-edit-link',
			selector: '[data-tutorial="status-edit-link"]',
			...L.steps['status-edit-link'],
			position: 'bottom',
		},
		// ④ 画面の見方（チャート直下の注記を起点に読み方を案内、子供 1 人以上で描画）
		{
			id: 'status-radar',
			selector: '[data-tutorial="status-radar-note"]',
			...L.steps['status-radar'],
			optional: true,
			position: 'top',
		},
		// ⑤ 分析サマリーを読み取り → 次の一手を決める (子供 1 人以上で描画)
		{
			id: 'status-act',
			selector: '[data-tutorial="status-summary"]',
			...L.steps['status-act'],
			optional: true,
			position: 'top',
		},
		// ⑥ 先月からの変化 (先月の記録があるお子さまでのみ描画)
		{
			id: 'status-monthly-change',
			selector: '[data-tutorial="status-monthly-change"]',
			...L.steps['status-monthly-change'],
			optional: true,
			position: 'top',
		},
		// ⑦ レベル称号カスタマイズ (常設、本ページ唯一の書き込み機能)
		{
			id: 'status-level-titles',
			selector: '[data-tutorial="status-level-titles"]',
			...L.steps['status-level-titles'],
			position: 'top',
		},
		// ⑧ ベンチマーク編集 (ops / NUC 単一運用者のみ描画)
		{
			id: 'status-benchmark-edit',
			selector: '[data-tutorial="status-benchmark-edit"]',
			...L.steps['status-benchmark-edit'],
			optional: true,
			position: 'top',
		},
	],
};
