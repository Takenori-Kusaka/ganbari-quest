import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #4658 (EPIC #4650 PO 判断 4 / 5): 用語を画面側の「変換」に統一し (旧ガイドは「交換」)、タブ名 /
// 確定ボタン名を実装文言に合わせ、3 つの入力方法と変換りれきを step 化する。
// 「押す」と書く step は必ず実要素に spotlight する — 残高カード (残高のあるお子さまが 1 人以上) と
// りれき (選択中のお子さまに記録がある) は filterGuideStepsByTargetPresence で描画時のみ出る。
// 変換フォーム自体はカードを押した後にしか描画されないため、モード説明 step は selector を持たず
// 中央 modal で説明する (「押す」型にしない)。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminPoints;

export const POINTS_GUIDE: PageGuide = {
	pageId: 'admin-points',
	title: L.title,
	icon: '💰',
	steps: [
		// ① ページ概要
		{
			id: 'points-intro',
			...L.steps['points-intro'],
		},
		// ② 画面の見方 — 残高カード群
		{
			id: 'points-balances',
			selector: '[data-tutorial="points-child-balances"]',
			...L.steps['points-balances'],
			position: 'bottom',
		},
		// ③ 最頻操作 — 変換の起点 (残高のある先頭のお子さまのカード)
		{
			id: 'points-convert',
			selector: '[data-tutorial="points-first-balance"]',
			...L.steps['points-convert'],
			position: 'bottom',
		},
		// 3 つの入力方法 (フォームはカードを押した後にのみ描画されるため中央 modal で説明する)
		{
			id: 'points-modes',
			...L.steps['points-modes'],
		},
		// 変換りれき (記録があるときのみ)
		{
			id: 'points-history',
			selector: '[data-tutorial="points-history"]',
			...L.steps['points-history'],
			position: 'top',
		},
	],
};
