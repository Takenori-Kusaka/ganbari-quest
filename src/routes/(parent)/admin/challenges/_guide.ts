import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
// #4671 (EPIC #4650): 旧実装は 3 step すべて selector 無し = 全部が中央 modal で、
//   「上のタブで絞り込む」「カードの削除」と操作を案内しても何も光らなかった (PO 判断 4 違反)。
//   画面の DOM 順 (家族ストリーク → お子さまタブ → 今週のカード → 削除) に anchor を張り、
//   条件表示 (ストリーク 0 日 / 子供 1 人 / カード 0 件) の step は `optional` で起動時 DOM 判定する。
//   巨大要素 (challenges-page 全体) は spotlight target にしない (#2926 layout invariant 整合)。
const L = PAGE_GUIDE_LABELS.adminChallenges;

export const CHALLENGES_GUIDE: PageGuide = {
	pageId: 'admin-challenges',
	title: L.title,
	icon: '🏆',
	steps: [
		// ① ページ概要（#3193: アプリ自動生成・全プラン・読み取り専用ビュー）
		{
			id: 'challenges-intro',
			...L.steps['challenges-intro'],
		},
		// ② 家族ストリーク (currentStreak > 0 のときだけ描画)
		{
			id: 'challenges-family-streak',
			selector: '[data-tutorial="challenges-family-streak"]',
			...L.steps['challenges-family-streak'],
			optional: true,
			position: 'bottom',
		},
		// ③ お子さまタブ (子供 2 人以上のときだけ描画)
		{
			id: 'challenges-child-tabs',
			selector: '[data-tutorial="challenges-child-tabs"]',
			...L.steps['challenges-child-tabs'],
			optional: true,
			position: 'bottom',
		},
		// ④ 今週のカードの見方 (カードが 1 件以上あるときだけ描画)
		{
			id: 'challenges-card',
			selector: '[data-tutorial="challenges-card"]',
			...L.steps['challenges-card'],
			optional: true,
			position: 'bottom',
		},
		// ⑤ 削除 (カードが 1 件以上あるときだけ描画)
		{
			id: 'challenges-delete',
			selector: '[data-tutorial="challenges-delete"]',
			...L.steps['challenges-delete'],
			optional: true,
			position: 'top',
		},
	],
};
