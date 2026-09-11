import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #4660 (EPIC #4650 PO 判断 4 / 5): step ② の anchor を「追加する」ボタン行 (toolbar) から
// カード一覧 (.children-page__list) へ移し、③ と同じ領域を連続で光らせる問題を解消する。
// 詳細カード (お子さま選択時のみ描画) の step を追加し、上限到達時に消える追加ボタンを指す step は
// filterGuideStepsByTargetPresence (AdminLayout が起動直前に適用) で出し分ける。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminChildren;

export const CHILDREN_GUIDE: PageGuide = {
	pageId: 'admin-children',
	title: L.title,
	icon: '👦',
	steps: [
		// ① ページ概要
		{
			id: 'children-intro',
			...L.steps['children-intro'],
		},
		// ② 最頻操作 — 追加する (上限到達時は disabled ボタンに置換されるため step ごと出ない)
		{
			id: 'children-add',
			selector: '[data-tutorial="add-child-btn"]',
			...L.steps['children-add'],
			position: 'bottom',
		},
		// ③ 画面の見方 — お子さまカード一覧 (0 人でも wrapper は描画される)
		{
			id: 'children-list',
			selector: '[data-tutorial="children-list"]',
			...L.steps['children-list'],
			position: 'top',
		},
		// ④ 詳細カード (お子さまを選んでいるときのみ)
		{
			id: 'children-detail',
			selector: '[data-tutorial="child-detail"]',
			...L.steps['children-detail'],
			position: 'top',
		},
	],
};
