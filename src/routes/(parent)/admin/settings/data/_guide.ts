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
		// #3307: エクスポートは canExport (スタンダード以上) gate。free では同セクションが
		// upsell 表示になり「ボタンひとつで保存できます」が実態と乖離する (NN/G #1 / ADR-0013)。
		// requiredTier='standard' で free からは本 step を除外し誤案内を防ぐ
		// (filterGuideStepsByTier、activities-add と同型)。free は ①概要 + ②画面の見方 が残る。
		{
			id: 'settings-data-export',
			selector: '[data-testid="data-export-section"]',
			requiredTier: 'standard',
			...L.steps['settings-data-export'],
			position: 'bottom',
		},
	],
};
