import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > 通知 ページガイド。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
//
// #4664 (EPIC #4650): 旧 3 step は「届く先」を取り違え（保護者の端末に届くのに
//   「お子さま自身が思い出すきっかけ」）、通知種別も実チェックボックスとずれ、
//   リマインダー時刻 / サイレント時間帯 / 1 日の上限 / ブロック中の復旧手順に触れて
//   いなかった。DOM 順（ステータス → 種類 → サイレント時間帯 → 保存）で step を置き直す。
//   リマインダー / ストリーク警告 は配信スケジューラが無く UI ごと外したため step も持たない。
//   全 step が常設要素を指すので optional は使わない（anchor 退行を隠さない）。
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
		// ② ブラウザ通知の状態
		{
			id: 'settings-notifications-status',
			selector: '[data-tutorial="notification-browser-status"]',
			...L.steps['settings-notifications-status'],
			position: 'bottom',
		},
		// ③ 受け取るお知らせの種類
		{
			id: 'settings-notifications-types',
			selector: '[data-tutorial="notification-settings"]',
			...L.steps['settings-notifications-types'],
			position: 'bottom',
		},
		// ④ サイレント時間帯
		{
			id: 'settings-notifications-quiet',
			selector: '[data-tutorial="notification-quiet-hours"]',
			...L.steps['settings-notifications-quiet'],
			position: 'top',
		},
		// ⑤ 保存
		{
			id: 'settings-notifications-save',
			selector: '[data-tutorial="notification-save"]',
			...L.steps['settings-notifications-save'],
			position: 'top',
		},
	],
};
