import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3263 (EPIC #3260 F2) / #3269 (C5) / #4677 (EPIC #4650): みんなのテンプレート（一覧）ガイド。
// AdminLayout 非使用ページのため marketplace/+layout.svelte が独自配線する。
// 詳細ルート /marketplace/[type]/[itemId] は dedicated guide（MARKETPLACE_DETAIL_GUIDE）を持つ。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
//
// #4677: step は画面の「上から下」順（EPIC #4650 判断 5）。「押す」と書く step は必ず光る（判断 4）:
// - 条件付きで描画される UI（年齢自動フィルタ hint = ログイン + お子さま選択中のみ / 先頭カード =
//   一覧 1 件以上 / empty state = 0 件時）は `optional: true` で宣言し、engine が起動時点の DOM に
//   対象が無ければ step ごと省く（中央 fallback で「タップします」を出さない）。
// - responsive で片方しか描画されない UI（mobile の ⚙️ フィルタ ボタン / desktop の しぼりこむ
//   パネル）はカンマ区切り selector で両候補を書き、engine が可視の方に spotlight する。
const L = PAGE_GUIDE_LABELS.marketplace;

export const MARKETPLACE_GUIDE: PageGuide = {
	pageId: 'marketplace',
	title: L.title,
	icon: '🛍️',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal 表示）
		{
			id: 'marketplace-intro',
			...L.steps['marketplace-intro'],
		},
		// ② 種類で絞り込む（type filter = 3 種類カード、常在）
		{
			id: 'marketplace-browse',
			selector: '[data-tutorial="marketplace-type-filter"]',
			...L.steps['marketplace-browse'],
			position: 'bottom',
		},
		// ③ 年齢に合わせた表示（ログイン + お子さま選択中のみ描画される hint バナー → optional）
		{
			id: 'marketplace-age-auto',
			selector: '[data-tutorial="marketplace-age-auto-filter"]',
			optional: true,
			...L.steps['marketplace-age-auto'],
			position: 'bottom',
		},
		// ④ しぼりこむ（mobile = ⚙️ フィルタ ボタン / desktop = 左のしぼりこむパネル。可視の方が光る）
		{
			id: 'marketplace-filter',
			selector:
				'[data-tutorial="marketplace-filter-open"], [data-tutorial="marketplace-filter-panel"]',
			...L.steps['marketplace-filter'],
			position: 'bottom',
		},
		// ⑤ ならべかえ（常在）
		{
			id: 'marketplace-sort',
			selector: '[data-tutorial="marketplace-sort"]',
			...L.steps['marketplace-sort'],
			position: 'bottom',
		},
		// ⑥ テンプレートを開く（先頭カード。一覧 0 件時は描画されない → optional）
		{
			id: 'marketplace-open',
			selector: '[data-tutorial="marketplace-item-card"]',
			optional: true,
			...L.steps['marketplace-open'],
			position: 'bottom',
		},
		// ⑥' 0 件のとき（empty state の「フィルタをクリア」。1 件以上なら描画されない → optional）
		{
			id: 'marketplace-empty',
			selector: '[data-tutorial="marketplace-empty-reset"]',
			optional: true,
			...L.steps['marketplace-empty'],
			position: 'bottom',
		},
	],
};
