import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// step 1 は selector 省略で画面中央 modal 表示。巨大要素 (challenges-page) は target にしない。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
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
		// ② 画面の見方（進捗バー・履歴の確認）— selector 省略で画面中央 modal 表示
		// (巨大要素 challenges-page は spotlight target にしない、#2926 layout invariant 整合)
		{
			id: 'challenges-view',
			...L.steps['challenges-view'],
		},
		// ③ 最頻操作（お子さま絞り込み・削除）— #3270 (EPIC #3260 C6): 2 step だった guide を
		// 3 部構成（①概要→②見方→③操作）に補完。child-tabs / 削除は条件表示（子 2 人以上 / カード有無）
		// のため spotlight target にせず、本ページの確立された center-modal 設計に揃える。
		{
			id: 'challenges-manage',
			...L.steps['challenges-manage'],
		},
	],
};
