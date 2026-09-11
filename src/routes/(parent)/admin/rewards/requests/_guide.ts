import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ「ごほうび申請の承認」のページガイド。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
// #4676 (EPIC #4650): 旧 step 2 はページ最外 div (見出し・戻るリンク・履歴を含む) を spotlight して
//   いて概要 step と見分けが付かず、申請 0 件のときは説明されている承認 / 却下ボタンが画面に無かった。
//   未処理セクション / 承認ボタン / 却下ボタン / 履歴セクションに anchor を分け、ボタンの step は
//   `optional`（未処理の申請があるときだけ描画される）にする。
const L = PAGE_GUIDE_LABELS.adminRewardsRequests;

export const REWARDS_REQUESTS_GUIDE: PageGuide = {
	pageId: 'admin-rewards-requests',
	title: L.title,
	icon: '🎁',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal 表示）
		{
			id: 'rewards-requests-intro',
			...L.steps['rewards-requests-intro'],
		},
		// ② 未処理の申請（常設セクション。0 件でも「申請はありません」を表示する）
		{
			id: 'rewards-requests-pending',
			selector: '[data-tutorial="rewards-requests-pending"]',
			...L.steps['rewards-requests-pending'],
			position: 'bottom',
		},
		// ③ 承認する（未処理の申請が 1 件以上あるときだけ描画）
		{
			id: 'rewards-requests-approve',
			selector: '[data-tutorial="rewards-requests-approve"]',
			...L.steps['rewards-requests-approve'],
			optional: true,
			position: 'bottom',
		},
		// ④ 却下する（未処理の申請が 1 件以上あるときだけ描画）
		{
			id: 'rewards-requests-reject',
			selector: '[data-tutorial="rewards-requests-reject"]',
			...L.steps['rewards-requests-reject'],
			optional: true,
			position: 'bottom',
		},
		// ⑤ 履歴（常設セクション）
		{
			id: 'rewards-requests-history',
			selector: '[data-tutorial="rewards-requests-history"]',
			...L.steps['rewards-requests-history'],
			position: 'top',
		},
	],
};
