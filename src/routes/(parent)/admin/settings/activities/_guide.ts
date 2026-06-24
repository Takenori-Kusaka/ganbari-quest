import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > 活動・ポイント（ステータス減少 / ポイント表示）ページガイド。
// narrative 3 部構成（①概要 → ②画面の見方 → ③最頻操作、#2927 / ADR-0012）。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
const L = PAGE_GUIDE_LABELS.adminSettingsActivities;

export const SETTINGS_ACTIVITIES_GUIDE: PageGuide = {
	pageId: 'admin-settings-activities',
	title: L.title,
	icon: '📝',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'settings-activities-intro',
			...L.steps['settings-activities-intro'],
		},
		// ② 画面の見方（ステータス減少）— ページ先頭セクション
		{
			id: 'settings-activities-decay',
			selector: '[data-testid="settings-decay-section"]',
			...L.steps['settings-activities-decay'],
			position: 'bottom',
		},
		// ③ 最頻操作（ポイント表示）
		{
			id: 'settings-activities-point',
			selector: '#point-settings',
			...L.steps['settings-activities-point'],
			position: 'bottom',
		},
	],
};
