import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ「賞状コレクション」のページガイド。
// 利用頻度が低いため簡潔（②画面の見方 → ③最頻操作の 2 step、selector 省略で画面中央 modal）。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminCertificates;

export const CERTIFICATES_GUIDE: PageGuide = {
	pageId: 'admin-certificates',
	title: L.title,
	icon: '🏆',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal 表示）
		{
			id: 'certificates-intro',
			...L.steps['certificates-intro'],
		},
		// ② 画面の見方（お子さまタブ + カテゴリ別の賞状一覧）
		{
			id: 'certificates-view',
			...L.steps['certificates-view'],
		},
	],
};
