import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > アカウント（おやカギ変更）ページガイド。
// narrative 3 部構成（①概要 → ②画面の見方 → ③最頻操作、#2927 / ADR-0012）。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
const L = PAGE_GUIDE_LABELS.adminSettingsAccount;

export const SETTINGS_ACCOUNT_GUIDE: PageGuide = {
	pageId: 'admin-settings-account',
	title: L.title,
	icon: '🔑',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'settings-account-intro',
			...L.steps['settings-account-intro'],
		},
		// ② 画面の見方（おやカギ）— 全環境で表示される唯一の主要カード
		{
			id: 'settings-account-pin',
			selector: '[data-tutorial="pin-settings"]',
			...L.steps['settings-account-pin'],
			position: 'bottom',
		},
		// ③ 最頻操作（おやカギを変える）
		{
			id: 'settings-account-pin-change',
			selector: '[data-tutorial="pin-settings"]',
			...L.steps['settings-account-pin-change'],
			position: 'bottom',
		},
	],
};
