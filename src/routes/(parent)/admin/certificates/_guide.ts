import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ「がんばり証明書」のページガイド。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
// #4674 (EPIC #4650): 旧実装は 2 step とも selector 省略の中央 modal で、「上のお子さまタブで
//   切り替える」と案内しても何も光らなかった (PO 判断 4 違反)。お子さま切替ボタン行と一覧に
//   anchor を張り、最頻操作 (カードを開いて印刷 / シェア) の step を追加する。
//   お子さま 0 人 / 証明書 0 件では対象が描画されないため `optional` で起動時 DOM 判定する。
const L = PAGE_GUIDE_LABELS.adminCertificates;

export const CERTIFICATES_GUIDE: PageGuide = {
	pageId: 'admin-certificates',
	title: L.title,
	icon: '🏆',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal 表示）
		{
			id: 'certificates-intro',
			...L.steps['certificates-intro'],
		},
		// ② お子さまを切り替える（お子さまが 1 人以上のときだけ描画）
		{
			id: 'certificates-child-select',
			selector: '[data-tutorial="certificates-child-select"]',
			...L.steps['certificates-child-select'],
			optional: true,
			position: 'bottom',
		},
		// ③ 証明書を開いて印刷・シェアする（証明書が 1 件以上あるときだけ描画）
		{
			id: 'certificates-open',
			selector: '[data-tutorial="certificates-open"]',
			...L.steps['certificates-open'],
			optional: true,
			position: 'top',
		},
	],
};
