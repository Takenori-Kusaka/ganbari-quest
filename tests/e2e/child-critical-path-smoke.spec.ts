// tests/e2e/child-critical-path-smoke.spec.ts
//
// #2520 AC9 — 子供 critical path smoke (ADR-0012 anti-engagement「記録する→数秒で閉じる」最短経路)
//
// 子供 UI の価値は「活動を記録 → ポイントが反映 → すぐ閉じて日常に戻る」最短経路にある
// (ADR-0012)。per-child SSOT refactor (ADR-0055) の後でもこの core loop が壊れていないことを
// 1 mode (elementary = 子供コアモード代表) で最小 smoke する。
//
// 既存 smoke.spec.ts は preschool で個別ステップ (ダイアログ表示 / キャンセル / ポイント表示) を
// 検証するが、本 spec は「記録 → ポイント反映 → home 復帰」を 1 本の連続フローとして固定し、
// 途中の遷移破綻 (per-child SSOT 後の childId mismatch / ダイアログ閉じ後の白画面等) を捕捉する。

import { expect, test } from '@playwright/test';
import { recordAnyActivity, selectElementaryChildAndDismiss } from './helpers';

test.describe('#2520 AC9: 子供 critical path smoke (記録→反映→復帰)', () => {
	// 記録で DB を変更するため直列実行
	test.describe.configure({ mode: 'serial' });

	test('elementary: 活動記録 → ポイント反映 → ダイアログを閉じて home に留まる', async ({
		page,
	}) => {
		test.slow(); // 記録リトライで時間がかかる可能性

		// 1. 子供を選択して home (オーバーレイ閉じ済み)
		await selectElementaryChildAndDismiss(page);
		await expect(page).toHaveURL(/\/elementary\/home/);

		// 2. 活動を 1 件記録
		const recorded = await recordAnyActivity(page);
		expect(recorded, '少なくとも 1 件の活動を記録できること').toBe(true);

		// 3. ポイントが反映される (結果ダイアログに `+N` 表示 = ADR-0012 の即時フィードバック)
		await expect(page.getByText(/\+\d+/).first()).toBeVisible();

		// 4. 結果ダイアログを閉じる (「数秒で閉じる」最短経路)
		const confirmBtn = page
			.getByTestId('activity-confirm-btn')
			.or(page.getByTestId('login-bonus-confirm'))
			.first();
		await expect(confirmBtn).toBeVisible();
		await confirmBtn.click();

		// 5. home に留まり (白画面・別画面遷移なし)、活動カードが再び操作可能
		await expect(page).toHaveURL(/\/elementary\/home/);
		await expect(page.locator('[data-testid^="activity-card-"]').first()).toBeVisible();
	});
});
