import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3268 (EPIC #3260 C4): 家族メンバー（招待・閲覧リンク）ページガイド。
// narrative 3 部構成（①概要 → ②画面の見方 → ③最頻操作、#2927 / ADR-0012）。
// 「保留中の招待」「閲覧リンク（family 限定）」は条件表示のため step の anchor にせず、
// 常在する「メンバー一覧」「招待リンク作成」を指す。文言は labels.ts に集約（#3264 / F3）。
const L = PAGE_GUIDE_LABELS.adminMembers;

export const MEMBERS_GUIDE: PageGuide = {
	pageId: 'admin-members',
	title: L.title,
	icon: '👪',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'members-intro',
			...L.steps['members-intro'],
		},
		// ② 画面の見方（今のメンバー）— 常在
		{
			id: 'members-list',
			selector: '[data-tutorial="members-list"]',
			...L.steps['members-list'],
			position: 'bottom',
		},
		// ③ 最頻操作（招待リンクを作る）— 常在
		{
			id: 'members-invite',
			selector: '[data-tutorial="members-invite"]',
			...L.steps['members-invite'],
			position: 'bottom',
		},
	],
};
