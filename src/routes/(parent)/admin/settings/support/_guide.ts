import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > サポート・アプリ情報ページガイド。
// ページ先頭がお問い合わせフォーム（最頻操作）のため、②で直接フォームを指す 2 step 構成
// （①概要 → ②最頻操作）。MAX_STEPS=5 の上限内。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
const L = PAGE_GUIDE_LABELS.adminSettingsSupport;

export const SETTINGS_SUPPORT_GUIDE: PageGuide = {
	pageId: 'admin-settings-support',
	title: L.title,
	icon: '💬',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'settings-support-intro',
			...L.steps['settings-support-intro'],
		},
		// ② 最頻操作（感想・要望を送る）— ページ先頭のフォーム
		{
			id: 'settings-support-form',
			selector: '[data-tutorial="feedback-section"]',
			...L.steps['settings-support-form'],
			position: 'bottom',
		},
	],
};
