// labels 層 (ADR-0045 / #4965): 子供の切り替え画面 (src/routes/switch)。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS } from '../admin-screens';
import { ADMIN_VIEW_TERMS, PARENT_TERMS } from '../terms';

// ============================================================
// #2138 MP-3: /admin/settings/rules — 取込済 rule-preset 管理画面
// ============================================================

// #2895: marketplace 陳列撤去に伴い、本画面は「取込済 bonus ルールの確認 + ON/OFF + 削除」に簡素化。
// 旧 marketplace import 受付 / OverflowMenu / help-restore-export dialog 系のラベルは撤去した。

// #2295 (EPIC #2294 ①): DEMO_EVENTS_LABELS 削除済 (2026-05-19) — シーズンイベント機構撤去

export const SWITCH_PAGE_LABELS = {
	adminForbiddenNotice: 'おやのアカウントでログインしてね',
	heading: 'だれがつかう？',
	emptyTitle: 'こどもがまだいないよ',
	emptyDesc: `${PARENT_TERMS.neutral}が${ADMIN_VIEW_TERMS.canonical}からついかしてね`,
	// #2353 設計欠陥 3: 「親しか押さないボタンなのにひらがな表記する理由がない」
	// #4715: 遷移先の画面名 (registry SSOT) をそのまま出す。旧「保護者の見守り画面」は
	//   同じ画面の 3 つ目の呼び名で、着地先の title / 見出しと一致していなかった。
	adminLink: `🔒 ${ADMIN_SCREENS.home.name}`,
	// #4512: server action のエラー文言 (旧: +page.server.ts 直書き)
	errorChildRequired: 'こどもをえらんでね',
	errorChildNotSelectable: 'このプロフィールは選べません',
} as const;
