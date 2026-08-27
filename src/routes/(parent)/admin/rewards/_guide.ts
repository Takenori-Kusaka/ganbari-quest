import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import { CONCEPT_ICONS } from '$lib/domain/terms';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #4656 (EPIC #4650 PO 判断 4 / 5): 3 step 固定をやめ、画面の上から下 (+ 追加 → ︙ → お子さまタブ →
// 一覧カード) の順に主要操作を網羅する。旧 step 3 は「+ 追加」trigger を光らせながら「下の作成フォーム」
// (#2998 で Dialog 化済) を案内して乖離していた。「押す」と書く step は必ず実要素に spotlight する —
// お子さまタブ (0 人で非表示) / 一覧カード (0 件で非表示) は filterGuideStepsByTargetPresence
// (AdminLayout が起動直前に適用) で描画時のみ出る。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminRewards;

export const REWARDS_GUIDE: PageGuide = {
	pageId: 'admin-rewards',
	title: L.title,
	icon: CONCEPT_ICONS.reward,
	steps: [
		// ① ページ概要
		{
			id: 'rewards-intro',
			...L.steps['rewards-intro'],
		},
		// + 追加 dropdown (header 右上、常設)
		{
			id: 'rewards-add',
			selector: '[data-tutorial="rewards-add-start"]',
			...L.steps['rewards-add'],
			position: 'bottom',
		},
		// ︙ overflow (申請承認 / 復元 / エクスポート、常設)
		{
			id: 'rewards-overflow',
			selector: '[data-tutorial="rewards-overflow-menu"]',
			...L.steps['rewards-overflow'],
			position: 'bottom',
		},
		// お子さまタブ (お子さま 1 人以上のとき)
		{
			id: 'rewards-child-tabs',
			selector: '[data-tutorial="rewards-child-tabs"]',
			...L.steps['rewards-child-tabs'],
			position: 'bottom',
		},
		// 一覧の先頭カード (選択中のお子さまにごほうびが 1 件以上あるとき)
		{
			id: 'rewards-list',
			selector: '[data-tutorial="reward-card-first"]',
			...L.steps['rewards-list'],
			position: 'top',
		},
	],
};
