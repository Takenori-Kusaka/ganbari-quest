import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// #2319 で設定はハブ + 6 サブグループ (アカウント / 活動・ポイント / 通知 / データ / サポート /
// プラン) に分割済み。旧ガイドはサブページ内の selector (pin-settings 等) を参照していたが、
// ハブページ (/admin/settings) には存在しないため、本ページではハブのカード構成を案内する。
// step 1 は selector 省略で画面中央 modal 表示。② はハブ冒頭の説明カード (小要素)、③ は先頭の
// 設定カード (アカウント、小要素) を target にする。グリッド全体 (settings-hub = mobile で 6 枚
// 縦積み = 縦長) は driver.js が非重複でバブルを置けないため target にしない (#2927: mobile ②
// で縦長グリッドにバブルが重なる exempt を解消)。
// #2057: 「管理画面」 → 「ご家族の見守り画面」 rename atom は labels.ts の settings-intro 内で参照。
// #3264 (EPIC #3260 F3): 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約。
const L = PAGE_GUIDE_LABELS.adminSettings;

export const SETTINGS_GUIDE: PageGuide = {
	pageId: 'admin-settings',
	title: L.title,
	icon: '⚙️',
	steps: [
		// ① ページ概要
		{
			id: 'settings-intro',
			...L.steps['settings-intro'],
		},
		// ② 画面の見方（ハブ冒頭の説明カードを起点にグループ構成を案内）
		{
			id: 'settings-hub',
			selector: '[data-tutorial="settings-hub-intro"]',
			...L.steps['settings-hub'],
			position: 'bottom',
		},
		// ③ 最頻操作（先頭のアカウントカードを起点におやカギ変更を案内）
		{
			id: 'settings-account',
			selector: '[data-tutorial="settings-first-card"]',
			...L.steps['settings-account'],
			position: 'bottom',
		},
	],
};
