// tests/e2e/goal-flows-exemplar.spec.ts
// #2544: goal 完遂検証の exemplar (手本) spec
//
// 背景: 初顧客レビュー直前、marketplace 取込ダイアログで「追加ボタン無反応・キャンセル不能」
//   (機能 dead-end) を実ユーザーが 1 分で発見。一方 E2E `admin-unified-import-hub.spec.ts` は
//   「ダイアログが render される / testid visible」だけを assert して PASS していた
//   (render proxy は緑、goal 完遂は壊れている、#2544 research §1)。
//
// 本 spec の役割: `tests/e2e/helpers/goal-flows.ts` の helper を使い、
//   「open → act → outcome assert」を貫通する正解 pattern を 1 本提示する exemplar。
//   既存 40 render-only spec の一括 outcome 化は本 PR の範囲外 (Issue B / #2459 P2-P5)。
//
// 検証する CUJ:
//   1. 活動を追加する経路 (今回壊れた経路) で「cancel が機能する = dead-end でない」を貫通
//   2. checklist 取込で「click → 成功 action message visible = goal 完遂」を貫通
//      (#2774 5 type 統一: marketplace → admin/checklists?import= → ChildSelectionDialog
//       → 確定 → success action message)
//
// 認証: AUTH_MODE=local の自動セットアップで /admin 配下に到達できる前提
//   (hooks.server.ts + tests/e2e/global-setup.ts の tenant seed)。
//
// 関連: #2544 / #2459 / #2774 / ADR-0007 / tests/CLAUDE.md §interactive flow

import { expect, test } from '@playwright/test';
import { expectDialogCancellable } from './helpers/goal-flows';

test.describe('#2544 goal 完遂 exemplar', () => {
	test.setTimeout(180_000); // Vite dev コールドコンパイル耐性

	// ============================================================
	// CUJ-1: 活動を追加する経路で cancel が機能する = dead-end (cancel 不能) でないことを貫通検証。
	//   #2558 段階2: 旧 import 項目 (admin 内ブラウズ UI、撤去済) は /marketplace 画面遷移に置換され、
	//   add dialog を開かなくなった。代表として manual 追加 dialog (add-activity-dialog) の
	//   cancel 可能性を検証する (同じ Dialog primitive、cancel 不能なら fail)。
	// ============================================================
	test('admin/activities: 手動追加 dialog を開いて閉じられる (cancel 不能 dead-end でない)', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('header-add-activity-btn')).toBeVisible({ timeout: 30_000 });

		// header + dropdown → 手動で1つ追加 → dialog 表示 → とじる → dialog が閉じる
		// cancel が壊れていれば最後の toBeHidden が必ず fail する。
		await expectDialogCancellable(page, {
			trigger: 'header-add-activity-btn',
			menuItem: 'menu-item-manual',
			dialogTestid: 'add-activity-dialog',
			// Dialog primitive の close trigger は aria-label='とじる' (UI_PRIMITIVES_LABELS.closeAriaLabel)。
			// Testing Library 原則に従い role/label で取得する。
			cancelLabel: 'とじる',
		});
	});

	// ============================================================
	// CUJ-5: checklist 取込で goal 完遂 を貫通検証する (新 flow #2774)。
	//   render-only でなく「実際に取り込まれた」結果 (success action message) を assert する。
	//
	//   #2774 5 type 統一 + #2558 段階3: admin/checklists 内 in-page UnifiedImportHub 撤去後の新 CUJ。
	//   marketplace 詳細 → <a href="/admin/checklists?import=<itemId>"> 直接 navigate
	//   → ChildSelectionDialog auto-open → 全員選択 + 確定 → success action message visible。
	// ============================================================
	test('admin/checklists: event-pool 取込 → 成功 action message visible (goal 完遂、dead-end なら fail)', async ({
		page,
	}) => {
		test.slow();

		// 1) marketplace 詳細 → checklist-import-cta visible (#2774 testid 規約)
		await page.goto('/marketplace/checklist/event-pool', { waitUntil: 'domcontentloaded' });
		const cta = page.getByTestId('checklist-import-cta');
		await expect(cta).toBeVisible({ timeout: 30_000 });

		// 2) <a> click → admin/checklists?import=event-pool へ navigate
		await cta.click();
		await page.waitForURL(/\/admin\/checklists\?import=event-pool/, { timeout: 15_000 });

		// 3) ChildSelectionDialog auto-open
		await expect(page.getByTestId('checklist-import-child-selection-dialog')).toBeVisible({
			timeout: 10_000,
		});

		// 4) 全員選択 + 確定
		await page.getByTestId('child-selection-all').click();
		await page.getByTestId('child-selection-confirm').click();

		// 5) 成功 action message visible (goal 完遂、無反応 / dead-end なら必ず fail)
		await expect(page.getByTestId('checklists-action-message')).toBeVisible({ timeout: 15_000 });
	});
});
