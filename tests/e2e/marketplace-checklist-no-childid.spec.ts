/**
 * tests/e2e/marketplace-checklist-no-childid.spec.ts
 *
 * #2362 PR-5 Phase 2 (ADR-0055 / CWE-598): checklist marketplace から childId 排除を検証。
 *
 * 検証対象:
 * 1. marketplace/checklist 詳細ページの URL に childId が含まれない
 * 2. ページ内に childId form input / select が存在しない
 * 3. 取込 button 押下 → /admin/checklists?import=<itemId> へ redirect
 * 4. admin 側で ChecklistDistributionDialog が auto-open される
 *
 * PR-4 marketplace-reward-set-import.spec.ts と同型 (reward-set, ADR-0055 §3.2 共通)。
 */

import { expect, test } from '@playwright/test';

test.describe('marketplace checklist: childId 排除 (#2362 PR-5 Phase 2 / CWE-598)', () => {
	test('marketplace 詳細 page の URL / form に childId が存在しない', async ({ page }) => {
		// event-pool は checklist marketplace SSOT に存在する preset id
		await page.goto('/marketplace/checklist/event-pool');

		// URL に childId 系 query が含まれていないこと
		const url = new URL(page.url());
		expect(url.searchParams.has('childId')).toBe(false);

		// page 内に childId / nickname 系 form input が存在しないこと
		// (旧来 <NativeSelect name="childId">) は本 Phase で撤去)
		const childIdInput = page.locator('input[name="childId"], select[name="childId"]');
		expect(await childIdInput.count()).toBe(0);
	});

	test('marketplace 取込 button 押下 → /admin/checklists?import=<itemId> へ redirect + dialog auto-open', async ({
		page,
	}) => {
		// PR-4 reward-set 同型: marketplace は child 情報を持たず admin へ遷移
		await page.goto('/marketplace/checklist/event-pool');

		const submitBtn = page.getByTestId('checklist-import-submit');
		// ADR-0006: skip-on-missing pattern (assertion 弱体化) は禁止、precondition assert に強化
		await expect(
			submitBtn,
			'checklist-import-submit が表示されない (認証 / 子供登録 を確認)',
		).toBeVisible({ timeout: 10_000 });

		// use:enhance 経由で 303 redirect → admin/checklists へ client-side navigation
		// `waitForResponse` で action response を待ち、その後 URL を `expect.poll` で確認
		const responsePromise = page.waitForResponse(
			(resp) => resp.url().includes('?/importChecklist') && resp.request().method() === 'POST',
			{ timeout: 15_000 },
		);
		await submitBtn.click();
		const response = await responsePromise;
		expect(response.status()).toBeLessThan(400);

		// Client-side navigation の完了を URL で待つ (load event 経由しない場合もあるため poll)
		await expect
			.poll(() => page.url(), { timeout: 15_000 })
			.toMatch(/\/admin\/checklists\?import=event-pool/);

		// admin/checklists 側で ChildSelectionDialog (auto-open) が表示される
		await expect(page.getByTestId('checklist-import-child-selection-dialog')).toBeVisible({
			timeout: 10_000,
		});
	});
});
