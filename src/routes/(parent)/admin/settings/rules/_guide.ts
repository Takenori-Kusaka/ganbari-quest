import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > ごほうび・ボーナスルールページガイド。
// #3954: 本ページは #3339 の「ごほうび交換の承認要否」も持つが、ガイドは取り込んだボーナスルール
// しか案内しておらず、ガイドに従う保護者が承認要否に到達できなかった。承認要否セクションを
// ② として追加し、3 step 構成（①概要 → ②画面の見方 → ③最頻操作）にする。MAX_STEPS=5 の上限内。
// 表示文言は labels.ts の PAGE_GUIDE_LABELS に SSOT 集約（#3264 / F3）。
//
// #4666 (EPIC #4650): ③ は「一覧は条件表示だから」という理由でページ先頭の header
//   (rules-overview) を代用しており、②承認セクションより上へ視線が戻るうえ、説明対象の
//   一覧自体は光らなかった。一覧 (rules-bonus-section) と空状態 (rules-empty-state) の
//   両方を包む常在ラッパー `rules-bonus-list` を page 側に置き、そこへ張り直す。
//   これで 0 件でも 1 件以上でも同じ場所が光り、step 順が DOM 順 (概要 → 承認 → 一覧) と一致する。
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
		// ③ よく使う操作（ボーナスルール）— 一覧と空状態を包む常在ラッパーを anchor
		{
			id: 'settings-rules-list',
			selector: '[data-tutorial="rules-bonus-list"]',
			...L.steps['settings-rules-list'],
			position: 'bottom',
		},
	],
};
