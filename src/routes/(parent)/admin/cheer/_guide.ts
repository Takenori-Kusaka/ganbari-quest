import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #4659 (EPIC #4650 PO 判断 4 / 5): 見出し 1 行だけを光らせる構成をやめ、実際に押す要素
// (お子さまボタン群 / 定型文チップ / 入力セクション / 応援するボタン / 履歴) を上から下の順に
// spotlight する。子供 0 人ではフォーム自体が描画されないため、該当 step は
// filterGuideStepsByTargetPresence (AdminLayout が起動直前に適用) で出ない。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminCheer;

export const CHEER_GUIDE: PageGuide = {
	pageId: 'admin-cheer',
	title: L.title,
	icon: '🎉',
	steps: [
		// ① ページ概要
		{
			id: 'cheer-intro',
			...L.steps['cheer-intro'],
		},
		// ② 送り先 (見出しではなく section 全体 = お子さまボタン群を含む)
		{
			id: 'cheer-select',
			selector: '[data-tutorial="cheer-child-select"]',
			...L.steps['cheer-select'],
			position: 'bottom',
		},
		// ③ 最速の操作 = 定型文チップ (1 タップで理由 / P / カテゴリ / アイコンが入る)
		{
			id: 'cheer-templates',
			selector: '[data-tutorial="cheer-templates"]',
			...L.steps['cheer-templates'],
			position: 'bottom',
		},
		// 理由とポイントを整える (section 全体)
		{
			id: 'cheer-reason',
			selector: '[data-tutorial="cheer-reason"]',
			...L.steps['cheer-reason'],
			position: 'bottom',
		},
		// 送信 (確認 + 応援するボタンの section)
		{
			id: 'cheer-submit',
			selector: '[data-tutorial="cheer-submit"]',
			...L.steps['cheer-submit'],
			position: 'top',
		},
		// 履歴 (送信済みの応援があるときのみ)
		{
			id: 'cheer-history',
			selector: '[data-tutorial="cheer-history"]',
			...L.steps['cheer-history'],
			position: 'top',
		},
	],
};
