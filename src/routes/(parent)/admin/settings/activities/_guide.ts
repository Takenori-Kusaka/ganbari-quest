import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > 活動・ポイント ページガイド。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
//
// #4663 (EPIC #4650): 旧 3 step はページ前半 (ステータス減少 / ポイント表示) で終わり、
//   後半の「既定の子供」「きょうだいチャレンジ設定」に step が無かった。カード単位で
//   必要な数だけ置く (EPIC #4650 PO 判断 5)。
//   「既定の子供」はお子さまが 2 人以上のときだけ描画されるため `optional` (#4668) を付け、
//   1 人のご家庭では step ごと出さない。きょうだいカードはプランに関わらず常設で
//   (チェックボックスが disabled になるだけ) のため optional にしない。
const L = PAGE_GUIDE_LABELS.adminSettingsActivities;

export const SETTINGS_ACTIVITIES_GUIDE: PageGuide = {
	pageId: 'admin-settings-activities',
	title: L.title,
	icon: '🎯',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'settings-activities-intro',
			...L.steps['settings-activities-intro'],
		},
		// ② ステータス減少（常設カード）
		{
			id: 'settings-activities-decay',
			selector: '[data-tutorial="settings-decay-section"]',
			...L.steps['settings-activities-decay'],
			position: 'bottom',
		},
		// ③ ポイント表示（常設カード）
		{
			id: 'settings-activities-point',
			selector: '[data-tutorial="settings-point-section"]',
			...L.steps['settings-activities-point'],
			position: 'top',
		},
		// ④ 既定の子供（お子さま 2 人以上のときだけ描画）
		{
			id: 'settings-activities-default-child',
			selector: '[data-tutorial="settings-default-child-section"]',
			...L.steps['settings-activities-default-child'],
			optional: true,
			position: 'top',
		},
		// ⑤ きょうだいランキング（カードは常設。プランでチェックが disabled になる）
		{
			id: 'settings-activities-sibling',
			selector: '[data-tutorial="settings-sibling-section"]',
			...L.steps['settings-activities-sibling'],
			position: 'top',
		},
	],
};
