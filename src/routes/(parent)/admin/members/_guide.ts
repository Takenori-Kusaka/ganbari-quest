import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3268 (EPIC #3260 C4): 家族メンバー（招待・閲覧リンク）ページガイド。文言は labels.ts に集約（#3264）。
// #4672 (EPIC #4650): step を画面の DOM 順（メンバー一覧 → 招待作成 → 保留中の招待 → 閲覧リンク）に
//   並べ、描画条件を持つカードは `optional` で起動時 DOM 判定する:
//     - 招待作成カードは `currentRole === 'owner'` 内にしか無い。保護者ロールでは step ごと消える
//       （旧実装は「作成ボタンを押す」と案内しながら何も光らない中央バブルになっていた、PO 判断 4）
//     - 保留中の招待は未受諾の招待が 1 件以上あるときだけ、閲覧リンクは family プランのときだけ描画
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
		// ② 画面の見方（現在のメンバー）— 常在
		{
			id: 'members-list',
			selector: '[data-tutorial="members-list"]',
			...L.steps['members-list'],
			position: 'bottom',
		},
		// ③ 招待リンクを作る（owner のときだけ描画）
		{
			id: 'members-invite',
			selector: '[data-tutorial="members-invite"]',
			...L.steps['members-invite'],
			optional: true,
			position: 'bottom',
		},
		// ④ 保留中の招待（未受諾の招待があるときだけ描画）
		{
			id: 'members-pending',
			selector: '[data-tutorial="members-pending"]',
			...L.steps['members-pending'],
			optional: true,
			position: 'bottom',
		},
		// ⑤ 閲覧リンク（family プランのときだけ描画）
		{
			id: 'members-viewer',
			selector: '[data-tutorial="members-viewer"]',
			...L.steps['members-viewer'],
			optional: true,
			position: 'top',
		},
	],
};
