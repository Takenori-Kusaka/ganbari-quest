// labels 層 (ADR-0045 / #4965): ナビ (親の管理画面ナビ / 子供ナビの年齢帯表記。2 つ以上の area で使う下層の共有)。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS } from '../admin-screens';
import { TEMPLATE_TERMS } from '../terms';
import { normalizeUiMode, type UiMode } from '../validation/age-tier-types';

// ============================================================
// ナビゲーションカテゴリ
// ============================================================

// #2177 (EPIC #2176): family カテゴリを subject-first 上位化で新設。
// admin-ia.md v1.0 (頻度ベース分類、#1395) を v2.0 (subject-first 上位化) に supersede。
// 配置順: family → activity → record → settings (Family Link / iOS HIG / Material 3 仕様準拠)。
export const NAV_CATEGORIES = {
	family: { label: '家族', icon: '👨‍👩‍👧' },
	activity: { label: '活動', icon: '🎮' },
	record: { label: '記録', icon: '📊' },
	settings: { label: '設定', icon: '⚙️' },
} as const;

export type NavCategoryId = keyof typeof NAV_CATEGORIES;

export const NAV_ITEM_LABELS = {
	// #1396: ご家族の見守り画面 ホームタブ（直接遷移・dropdown なし）
	home: 'ホーム',
	// #4715: nav / title / 見出しを同じ registry から引く (旧 nav「グロースブック」等の別名を廃止)
	reports: ADMIN_SCREENS.reports.name,
	growthBook: ADMIN_SCREENS.growthBook.name,
	achievements: ADMIN_SCREENS.challenges.name,
	// analytics: 削除 (#2284 EPIC #2283: /admin/analytics 撤去、運用者向け機能は /ops/analytics に移動)
	points: ADMIN_SCREENS.points.name,
	// #2270 / #2274 (EPIC #2266): 旧 messages 廃止 → cheer (応援) に統合 + activity 配下へ移動
	cheer: ADMIN_SCREENS.cheer.name,
	rewards: ADMIN_SCREENS.rewards.name,
	activities: ADMIN_SCREENS.activities.name,
	// #1168: チェックリスト（ナビは単一、ページ内タブで「持ち物」「ルーティン」に分離）
	checklists: ADMIN_SCREENS.checklists.name,
	itemChecklists: '持ち物チェックリスト',
	routineChecklists: 'ルーティン',
	// #2295 (EPIC #2294 ①): events 削除済 (2026-05-19)
	challenges: ADMIN_SCREENS.challenges.name,
	// #1170: マーケットプレイス グローバルナビ昇格 → #1212-H ADR-0041 呼称変更（テンプレート）
	// #2276: TEMPLATE_TERMS atom 参照化 (ADR-0045)
	marketplace: TEMPLATE_TERMS.short,
	children: ADMIN_SCREENS.children.name,
	settings: ADMIN_SCREENS.settings.name,
	license: ADMIN_SCREENS.subscription.name,
	billing: ADMIN_SCREENS.subscription.name,
	members: ADMIN_SCREENS.members.name,
	status: ADMIN_SCREENS.status.name,
} as const;

// ============================================================
// 子供画面のナビゲーションラベル（年齢帯 variant、#4715）
// ============================================================
//
// #4715: 以前は `src/lib/domain/icons.ts` の `MODE_LABELS` に置かれており、UI 文言の SSOT が
// labels.ts / icons.ts の 2 箇所に割れていた（icons.ts はアイコン定数の置き場であって文言の置き場ではない）。
// 文言はここに寄せ、呼び出し側は `getChildNavModeLabels()` を本ファイルから直接 import する。
//
// 呼称の是正（#4715）:
//   - `switch`: junior / senior が「メンバー」だった。親画面の「メンバー管理」（招待した大人）と
//     同じ語で別概念を指していたため「家族」に統一する。
//   - `checklist`: 「もちものチェック」「持ち物チェック」「もちもの」の 3 表記があり、
//     同じ画面にルーティン系プリセット（あさのしたく / よるのじゅんび）も並ぶのに名前が持ち物限定だった。
//     親画面の「チェックリスト管理」と同じ語幹の「チェックリスト」に寄せる。

// 型は本ファイル内でのみ使う（`getChildNavModeLabels()` の戻り値として推論される）。
// export すると参照ゼロの公開 export になり orphan-labels gate が新規 orphan として落とす。
interface ChildNavModeLabels {
	status: string;
	switch: string;
	history: string;
	achievements: string;
	titles: string;
	recordSummary: string;
	checklist: string;
}

export const CHILD_NAV_MODE_LABELS: Record<UiMode, ChildNavModeLabels> = {
	// baby = 親の準備モード（ADR-0011）: 子供向けゲーミフィケーション語彙ではなく親向けラベル
	baby: {
		status: 'せいちょうきろく',
		switch: 'かぞく',
		history: 'きろく',
		achievements: 'できたこと',
		titles: 'せいちょう',
		recordSummary: 'きょうの きろく',
		checklist: 'チェックリスト',
	},
	preschool: {
		status: 'つよさ',
		switch: 'かぞく',
		history: 'きろく',
		achievements: 'チャレンジきろく',
		titles: 'しょうごう',
		recordSummary: 'きょうの きろく',
		checklist: 'チェックリスト',
	},
	elementary: {
		status: 'つよさ',
		switch: 'かぞく',
		history: '記録',
		// #4690 F7: 同じ画面群で history が「記録」なのに achievements だけ「きろく」だった
		achievements: 'チャレンジ記録',
		titles: '称号',
		recordSummary: '今日の記録',
		checklist: 'チェックリスト',
	},
	junior: {
		status: 'ステータス',
		switch: '家族',
		history: '記録',
		achievements: 'チャレンジ記録',
		titles: '称号',
		recordSummary: '今日の記録',
		checklist: 'チェックリスト',
	},
	senior: {
		status: 'ステータス',
		switch: '家族',
		history: '記録',
		achievements: 'チャレンジ記録',
		titles: '称号',
		recordSummary: '今日の記録',
		checklist: 'チェックリスト',
	},
};

/** 年齢モード別の子供ナビラベルを安全に取得する（未知モードは preschool にフォールバック）。 */
export function getChildNavModeLabels(uiMode: string): ChildNavModeLabels {
	return CHILD_NAV_MODE_LABELS[normalizeUiMode(uiMode)] ?? CHILD_NAV_MODE_LABELS.preschool;
}
