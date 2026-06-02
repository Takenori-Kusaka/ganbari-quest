// tests/e2e/marketplace-reward-set-import.spec.ts
// #2136 MP-1 / PR-4 (#2474): マーケットプレイス reward-set 一括追加の E2E 検証
//
// PR #2474 (PR-4 / ADR-0055 + CWE-598) で動線が変更された:
//   - 旧 (#2136 MP-1): marketplace 詳細で child 選択 → form submit → reward-import-result toast
//   - 新 (PR #2474): marketplace 詳細では child 情報を一切受領せず、submit で `/admin/rewards?import=<itemId>`
//     へ redirect → admin 側で ChildSelectionDialog auto-open → per-child fan-out
//
// #2774 (5 type 統一): 旧 <form action="?/importRewardSet"> + submit button を <a href> に置換。
//   server action `importRewardSet` 撤去、CTA は <a> 直接 navigation。
//   testid 規約統一: `reward-import-cta` (`<typeCode>-import-cta`)。
//
// AC4 検証対象 (rewrite):
// 1. /marketplace/reward-set/<itemId> 詳細ページの CTA は child 選択を含まない (CWE-598)
// 2. CTA click で /admin/rewards?import=<itemId> へ navigate する
// 3. navigate 先の admin 画面で ChildSelectionDialog が auto-open する
// 4. /admin/rewards に直接アクセスしても新 UX (子供別タブ + per-child import) で動作する
//
// 認証: ローカル AUTH_MODE=local では admin 配下に自動アクセス可能
// (cognito mock 不要、global-setup.ts でテスト用テナント seed 済)。

import { expect, test } from '@playwright/test';

test.describe('#2136 MP-1 / PR-4 (#2474): marketplace reward-set 一括追加 (新動線)', () => {
	test('reward-set 詳細ページの CTA は child 選択 UI を含まない (CWE-598)', async ({ page }) => {
		await page.goto('/marketplace/reward-set/kinder-rewards');
		await expect(page).toHaveURL(/\/marketplace\/reward-set\/kinder-rewards/);

		// 詳細ページの header
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(/ようじごほうび/);

		// #2774 (5 type 統一): CTA visible (`<a>` element, `reward-import-cta` testid)
		const cta = page.getByTestId('reward-import-cta');
		await expect(cta).toBeVisible({ timeout: 10_000 });

		// PR #2474 ADR-0055 + CWE-598 / #2774: child 選択 UI (NativeSelect / input) は撤去済
		const childIdInput = page.locator('input[name="childId"], select[name="childId"]');
		expect(await childIdInput.count()).toBe(0);
	});

	test('CTA click → /admin/rewards?import=<itemId> へ navigate する', async ({ page }) => {
		await page.goto('/marketplace/reward-set/kinder-rewards');
		const cta = page.getByTestId('reward-import-cta');
		await expect(cta).toBeVisible({ timeout: 10_000 });

		// href が `/admin/rewards?import=<itemId>` を指す (CWE-598)
		const href = await cta.getAttribute('href');
		expect(href).toBe('/admin/rewards?import=kinder-rewards');
		expect(href).not.toContain('childId');

		// CTA click → client-side navigation で /admin/rewards?import=... へ遷移
		await cta.click();
		await page.waitForURL(/\/admin\/rewards\?import=kinder-rewards/, { timeout: 10_000 });

		// admin/rewards 側で URL に ?import= が設定される
		await expect(page).toHaveURL(/\/admin\/rewards\?import=kinder-rewards/);
	});

	test('redirect 先の admin 画面で ChildSelectionDialog が auto-open する', async ({ page }) => {
		// marketplace から navigate された後と同じ URL に直接アクセスして dialog auto-open を検証
		await page.goto('/admin/rewards?import=kinder-rewards');

		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });

		// 「全員に追加」option + 確定ボタンが visible (ChildSelectionDialog primitive 仕様)
		await expect(page.getByTestId('child-selection-all')).toBeVisible();
		await expect(page.getByTestId('child-selection-confirm')).toBeVisible();
	});

	test('/admin/rewards 直接アクセス: 子供別タブ + per-child UI が描画される (PR-4 新 UX)', async ({
		page,
	}) => {
		await page.goto('/admin/rewards');
		await expect(page).toHaveURL(/\/admin\/rewards/);

		// 旧 marketplace-reward-import-section は撤去済 (PR #2474)
		// 新 UX: 子供別タブ + child context banner
		const tabRow = page.getByTestId('admin-rewards-child-tabs');
		await expect(tabRow).toBeVisible({ timeout: 10_000 });

		// 各 child タブが描画される (testid prefix で検出)
		const firstTab = tabRow.locator('[data-testid^="rewards-child-tab-"]').first();
		await expect(firstTab).toBeVisible();
	});

	test('削除済の存在しない reward-set は 404 を返す', async ({ page }) => {
		// reward-set の itemId 整合性確認 — 既存 10 件以外は 404
		const response = await page.goto('/marketplace/reward-set/non-existent-reward-set');
		expect(response?.status()).toBe(404);
	});
});
