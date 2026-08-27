import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import { CONCEPT_ICONS } from '$lib/domain/terms';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #4655 (EPIC #4650 PO 判断 4 / 5): 3 step 固定をやめ、画面の上から下 (+ 追加 → ︙ → お子さまタブ →
// フィルタと検索 → 一覧 → 非表示の活動) の順に主要操作を網羅する。「押す」と書く step は必ず実要素に
// spotlight する — お子さまタブ (0 人で非表示) / 非表示の活動 (0 件で非表示) は
// filterGuideStepsByTargetPresence (AdminLayout が起動直前に適用) で描画時のみ出る。
// 活動の追加 step は全プランに出す (free でも 3 件まで追加できる、旧 requiredTier: 'standard' を撤去)。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminActivities;

export const ACTIVITIES_GUIDE: PageGuide = {
	pageId: 'admin-activities',
	title: L.title,
	// 概念アイコンは CONCEPT_ICONS.activity (📝) に統一 (旧 📋 は checklists と同一で揺れていた、F10)
	icon: CONCEPT_ICONS.activity,
	steps: [
		// ① ページ概要
		{
			id: 'activities-intro',
			...L.steps['activities-intro'],
		},
		// + 追加 dropdown (header 右上、常設)
		{
			id: 'activities-add',
			selector: '[data-tutorial="add-activity-btn"]',
			...L.steps['activities-add'],
			position: 'bottom',
		},
		// ︙ overflow (header 右端、常設)
		{
			id: 'activities-overflow',
			selector: '[data-tutorial="activities-overflow-menu"]',
			...L.steps['activities-overflow'],
			position: 'bottom',
		},
		// お子さまタブ (お子さま 1 人以上のとき)
		{
			id: 'activities-child-tabs',
			selector: '[data-tutorial="activities-child-tabs"]',
			...L.steps['activities-child-tabs'],
			position: 'bottom',
		},
		// カテゴリフィルタ (+ 検索は文言で案内)
		{
			id: 'activities-filter',
			selector: '[data-tutorial="category-filter"]',
			...L.steps['activities-filter'],
			position: 'bottom',
		},
		// 活動一覧の先頭カード (一覧全体は巨大コンテナのため target にしない。0 件のときは本 step は出ない)
		{
			id: 'activities-list',
			selector: '[data-tutorial="activity-card-first"]',
			...L.steps['activities-list'],
			position: 'top',
		},
		// 非表示の活動 (1 件以上のとき)
		{
			id: 'activities-hidden',
			selector: '[data-tutorial="hidden-activities"]',
			...L.steps['activities-hidden'],
			position: 'top',
		},
	],
};
