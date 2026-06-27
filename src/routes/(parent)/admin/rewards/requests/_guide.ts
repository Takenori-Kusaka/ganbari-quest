import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ「ごほうび申請の承認」のページガイド。
// 利用頻度が低いため簡潔（①概要 → ②最頻操作の 2 step）。
// ② はページの申請一覧領域（data-tutorial="rewards-requests-section"）をスポットライト。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
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
		// ② 最頻操作（申請を承認・却下する）— 申請一覧領域をスポットライト
		{
			id: 'rewards-requests-act',
			selector: '[data-tutorial="rewards-requests-section"]',
			...L.steps['rewards-requests-act'],
			position: 'bottom',
		},
	],
};
