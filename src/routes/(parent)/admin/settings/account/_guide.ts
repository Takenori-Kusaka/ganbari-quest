import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > アカウント（おやカギ変更）ページガイド。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
//
// #4662 (EPIC #4650): 旧 3 step は ② と ③ が同じ `pin-settings` カードを連続で光らせており、
//   同じカードが 2 回続くだけで情報量が実質 1 枚分しか無かった。統合して 1 step にし、
//   空いた枠を DOM 順の続き（ログアウト → アカウント削除）に充てる。
//   ログアウト / Danger Zone のカードは `authMode === 'cognito'` のときだけ描画されるため、
//   静的軸（requiredRuntime='saas' で NUC を除外）と起動時 DOM 判定（optional、#4668）の
//   両方を付ける。これで NUC には出さず、SaaS でもカードが無い環境（demo / local）では
//   step ごと落ちる = 「押せ」と書いた step が中央 fallback で成立することがない。
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
		// ② おやカギを変える（見方 + 手順を統合。全環境で描画される唯一の常設カード）
		{
			id: 'settings-account-pin',
			selector: '[data-tutorial="pin-settings"]',
			...L.steps['settings-account-pin'],
			position: 'bottom',
		},
		// ③ ログアウト（cognito 環境のみ描画）
		{
			id: 'settings-account-logout',
			selector: '[data-tutorial="account-logout"]',
			...L.steps['settings-account-logout'],
			requiredRuntime: 'saas',
			optional: true,
			position: 'top',
		},
		// ④ アカウント削除（Danger Zone、cognito 環境のみ描画）
		{
			id: 'settings-account-delete',
			selector: '[data-tutorial="account-danger-zone"]',
			...L.steps['settings-account-delete'],
			requiredRuntime: 'saas',
			optional: true,
			position: 'top',
		},
	],
};
