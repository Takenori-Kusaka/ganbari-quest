import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > データ（バックアップ / 復元）ページガイド。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
//
// #4665 (EPIC #4650): 旧 3 step は ② (データ管理カード全体) と ③ (その中の export ブロック) が
//   入れ子でほぼ同じ位置を光らせ、中段のクラウド共有と末尾の Danger Zone には到達しなかった。
//   カード / セクション単位に置き直す:
//     ① 概要 → ② バックアップをダウンロード → ③ 復元 (インポート) → ④ クラウド共有 → ⑤ 全削除
//   ② は canExport gate (スタンダード以上) のため requiredTier='standard' を維持する
//   (free では upsell 表示になり「ボタンひとつで保存できます」が実態と乖離する、#3307)。
//   ④ は SaaS (authMode==='cognito') のときだけ描画されるカードなので、静的軸
//   (requiredRuntime='saas') と起動時 DOM 判定 (optional、#4668) の両方を付ける。
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
		// ② バックアップをダウンロード（スタンダード以上）
		{
			id: 'settings-data-export',
			selector: '[data-tutorial="data-export-section"]',
			requiredTier: 'standard',
			...L.steps['settings-data-export'],
			position: 'bottom',
		},
		// ③ 復元（インポート）— 既定が「置換」= 全削除のため必ず説明する
		{
			id: 'settings-data-import',
			selector: '[data-tutorial="data-import-section"]',
			...L.steps['settings-data-import'],
			position: 'bottom',
		},
		// ④ クラウド共有（SaaS のみ描画）
		{
			id: 'settings-data-cloud',
			selector: '[data-tutorial="cloud-export-card"]',
			...L.steps['settings-data-cloud'],
			requiredRuntime: 'saas',
			optional: true,
			position: 'top',
		},
		// ⑤ すべてのデータを削除（Danger Zone、常設）
		{
			id: 'settings-data-clear',
			selector: '[data-tutorial="data-danger-zone"]',
			...L.steps['settings-data-clear'],
			position: 'top',
		},
	],
};
