import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > ごほうび・ボーナスルールページガイド。
// #3954: 本ページは #3339 の「ごほうび交換の承認要否」も持つが、ガイドは取り込んだボーナスルール
// しか案内しておらず、ガイドに従う保護者が承認要否に到達できなかった。承認要否セクションを
// ② として追加し、3 step 構成（①概要 → ②画面の見方 → ③最頻操作）にする。MAX_STEPS=5 の上限内。
// 一覧は取込件数で条件表示（0 件時は空状態）になるため、③ は常在する header を anchor とする。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
const L = PAGE_GUIDE_LABELS.adminSettingsRules;

export const SETTINGS_RULES_GUIDE: PageGuide = {
	pageId: 'admin-settings-rules',
	title: L.title,
	icon: '📜',
	steps: [
		// ① ページ概要（selector 省略で画面中央 modal）
		{
			id: 'settings-rules-intro',
			...L.steps['settings-rules-intro'],
		},
		// ② 画面の見方（ごほうび交換の承認）— #3954 の当該機能。常在セクションを anchor
		{
			id: 'settings-rules-approval',
			selector: '[data-tutorial="rules-reward-approval"]',
			...L.steps['settings-rules-approval'],
			position: 'bottom',
		},
		// ③ よく使う操作（取り込んだルール）— 常在する header を anchor（一覧は取込件数で条件表示）
		{
			id: 'settings-rules-list',
			selector: '[data-tutorial="rules-overview"]',
			...L.steps['settings-rules-list'],
			position: 'bottom',
		},
	],
};
