import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import { CONCEPT_ICONS } from '$lib/domain/terms';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #4657 (EPIC #4650 PO 判断 4 / 5): 3 step 固定をやめ、画面の上から下 (+ 追加 → ︙ → お子さまタブと検索 →
// 一覧カードの調整 → 本日のワンオフ) の順に主要操作を網羅する。旧 step 3 は本文の小さなリンクを指しつつ
// 存在しないボタン名 (「みんなのテンプレートを見る」「使ってみる」) を案内していた。
// 「押す」と書く step は必ず実要素に spotlight する — 条件付き要素 (お子さまタブ / 一覧カード /
// 本日のワンオフ) は filterGuideStepsByTargetPresence (AdminLayout が起動直前に適用) で描画時のみ出る。
// 用語は #2909 (PO 指摘 #2899 AC3) で「持ち物チェックリスト管理 → チェックリスト管理」へ是正済。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminChecklists;

export const CHECKLISTS_GUIDE: PageGuide = {
	pageId: 'admin-checklists',
	title: L.title,
	icon: CONCEPT_ICONS.checklist,
	steps: [
		// ① ページ概要
		{
			id: 'checklists-intro',
			...L.steps['checklists-intro'],
		},
		// + 追加 dropdown (header 右上、常設)
		{
			id: 'checklists-add',
			selector: '[data-tutorial="checklists-add-menu"]',
			...L.steps['checklists-add'],
			position: 'bottom',
		},
		// ︙ overflow (常設)
		{
			id: 'checklists-overflow',
			selector: '[data-tutorial="checklists-overflow-menu"]',
			...L.steps['checklists-overflow'],
			position: 'bottom',
		},
		// お子さまタブ (+ 検索は文言で案内。お子さま 1 人以上のとき)
		{
			id: 'checklists-child-tabs',
			selector: '[data-tutorial="checklists-child-tabs"]',
			...L.steps['checklists-child-tabs'],
			position: 'bottom',
		},
		// 一覧の先頭カード (チェックリストが 1 件以上のとき)
		{
			id: 'checklists-card',
			selector: '[data-tutorial="checklist-card-first"]',
			...L.steps['checklists-card'],
			position: 'top',
		},
		// 本日のワンオフ (当日の override が 1 件以上のとき)
		{
			id: 'checklists-override',
			selector: '[data-tutorial="checklists-today-override"]',
			...L.steps['checklists-override'],
			position: 'top',
		},
	],
};
