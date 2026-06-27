import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > 通知ページガイド。
// narrative 3 部構成（①概要 → ②画面の見方 → ③最頻操作、#2927 / ADR-0012）。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
const L = PAGE_GUIDE_LABELS.adminSettingsNotifications;

export const SETTINGS_NOTIFICATIONS_GUIDE: PageGuide = {
	pageId: 'admin-settings-notifications',
	title: L.title,
	icon: '🔔',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'settings-notifications-intro',
			...L.steps['settings-notifications-intro'],
		},
		// ② 画面の見方（通知のオン・オフ）— ページ先頭のブラウザ通知ステータス
		{
			id: 'settings-notifications-status',
			selector: '[data-testid="notification-browser-status"]',
			...L.steps['settings-notifications-status'],
			position: 'bottom',
		},
		// ③ 最頻操作（お知らせの種類）— 設定フォーム
		{
			id: 'settings-notifications-types',
			selector: '[data-tutorial="notification-settings"]',
			...L.steps['settings-notifications-types'],
			position: 'top',
		},
	],
};
