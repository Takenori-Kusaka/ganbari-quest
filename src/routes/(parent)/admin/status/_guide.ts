import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。② はチャート直下のレーダー注記 (小要素)、
// ③ は分析サマリー (読み取り → 次の一手を決める起点、小〜中要素) を target にする。
// 巨大要素 (status-report / status-radar = 280px チャート) は driver.js が非重複でバブルを置けないため
// target にしない (#2927: 旧 ②③ が status-radar を指していた exempt 常時発動を解消)。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
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
		// ② 画面の見方（チャート直下の注記を起点に読み方を案内）
		{
			id: 'status-radar',
			selector: '[data-tutorial="status-radar-note"]',
			...L.steps['status-radar'],
			position: 'top',
		},
		// ③ 最頻操作（分析サマリーを読み取り → 次の一手を決める）
		{
			id: 'status-act',
			selector: '[data-tutorial="status-summary"]',
			...L.steps['status-act'],
			position: 'top',
		},
	],
};
