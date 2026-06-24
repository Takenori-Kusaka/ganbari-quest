import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > データ（バックアップ / 復元）ページガイド。
// narrative 3 部構成（①概要 → ②画面の見方 → ③最頻操作、#2927 / ADR-0012）。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
const L = PAGE_GUIDE_LABELS.adminSettingsData;

export const SETTINGS_DATA_GUIDE: PageGuide = {
	pageId: 'admin-settings-data',
	title: L.title,
	icon: '💾',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'settings-data-intro',
			...L.steps['settings-data-intro'],
		},
		// ② 画面の見方（データ管理）— ページ先頭セクション（全環境で表示）
		{
			id: 'settings-data-management',
			selector: '[data-tutorial="data-management"]',
			...L.steps['settings-data-management'],
			position: 'bottom',
		},
		// ③ 最頻操作（バックアップ）
		{
			id: 'settings-data-export',
			selector: '[data-testid="data-export-section"]',
			...L.steps['settings-data-export'],
			position: 'bottom',
		},
	],
};
