/**
 * tests/e2e/marketplace-checklist-no-childid.spec.ts
 *
 * #2362 PR-5 Phase 2 (ADR-0055 / CWE-598): checklist marketplace から childId 排除を検証。
 * #2774 (5 type 統一): CTA は <a href> + testid `checklist-import-cta` に統一、
 *   server action `?/importChecklist` 撤去。
 *
 * 検証対象:
 * 1. marketplace/checklist 詳細ページの URL に childId が含まれない
 * 2. ページ内に childId form input / select が存在しない
 * 3. CTA click → /admin/checklists?import=<itemId> へ navigate
 * 4. admin 側で ChildSelectionDialog が auto-open される
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

	test('marketplace 取込 CTA click → /admin/checklists?import=<itemId> へ navigate + dialog auto-open', async ({
		page,
	}) => {
		// #2774 (5 type 統一): 旧 <form action="?/importChecklist"> を <a href> に置換、
		// server action 撤去。CTA は <a> 直接 navigation。
		await page.goto('/marketplace/checklist/event-pool');

		const cta = page.getByTestId('checklist-import-cta');
		// ADR-0006: skip-on-missing pattern (assertion 弱体化) は禁止、precondition assert に強化
		await expect(cta, 'checklist-import-cta が表示されない (認証 / 子供登録 を確認)').toBeVisible({
			timeout: 10_000,
		});

		// href が `/admin/checklists?import=<itemId>` を指す (childId 露出ゼロ、CWE-598)
		const href = await cta.getAttribute('href');
		expect(href).toBe('/admin/checklists?import=event-pool');
		expect(href).not.toContain('childId');

		// CTA click → client-side navigation で /admin/checklists?import=... へ navigate
		await cta.click();
		await page.waitForURL(/\/admin\/checklists\?import=event-pool/, { timeout: 15_000 });

		// admin/checklists 側で ChildSelectionDialog (auto-open) が表示される
		await expect(page.getByTestId('checklist-import-child-selection-dialog')).toBeVisible({
			timeout: 10_000,
		});
	});
});
