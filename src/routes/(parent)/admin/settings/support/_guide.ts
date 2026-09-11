import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > サポート・アプリ情報ページガイド。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
//
// #4667 (EPIC #4650): 旧 2 step はフォーム全体を 1 枚で扱い、先頭の「ご用件」ラジオ
//   （感想・要望 / 相談・困りごと）と、相談時に返信先メールが必要になる分岐に触れて
//   いなかった。DOM 順（フォーム → バックアップの状態 → アプリ情報）に step を置く。
//   「バックアップの状態」は NUC セルフホスト（DATA_SOURCE=pglite）のときだけ描画される
//   ため、静的軸（requiredRuntime='nuc' で SaaS を除外）と起動時 DOM 判定（optional、#4668）の
//   両方を付ける。他 2 step は常設要素なので optional にしない（anchor 退行を隠さない）。
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
		// ② サポート・ご意見フォーム（常設、ページ先頭）
		{
			id: 'settings-support-form',
			selector: '[data-tutorial="feedback-section"]',
			...L.steps['settings-support-form'],
			position: 'bottom',
		},
		// ③ バックアップの状態（NUC セルフホストのみ描画）
		{
			id: 'settings-support-backup',
			selector: '[data-tutorial="backup-health-card"]',
			...L.steps['settings-support-backup'],
			requiredRuntime: 'nuc',
			optional: true,
			position: 'top',
		},
		// ④ アプリ情報（常設、ページ末尾）
		{
			id: 'settings-support-app-info',
			selector: '[data-tutorial="app-info-card"]',
			...L.steps['settings-support-app-info'],
			position: 'top',
		},
	],
};
