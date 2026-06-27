import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #3266 (EPIC #3260 C2): 設定 > とくべつルール（取込済みボーナスルール）ページガイド。
// 一覧は取込件数で条件表示（0 件時は空状態）になるため、常在する header を ② の anchor とする
// 2 step 構成（①概要 → ②画面の見方）。MAX_STEPS=5 の上限内（最小数の規定は無い）。
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
		// ② 画面の見方（取り込んだルール）— 常在する header を anchor（一覧は取込件数で条件表示）
		{
			id: 'settings-rules-list',
			selector: '[data-tutorial="rules-overview"]',
			...L.steps['settings-rules-list'],
			position: 'bottom',
		},
	],
};
