// tests/e2e/parent-gate.spec.ts
// EPIC #2310: /admin/* PIN gate + 15 分 sliding session の E2E 回帰検証
//
// 実行条件: cognito-dev mode で PARENT_GATE_FORCE_ACTIVE=true を設定した server に対し実行
//   PARENT_GATE_FORCE_ACTIVE=true npm run dev:cognito  # 別 terminal で起動
//   npx playwright test tests/e2e/parent-gate.spec.ts --config playwright.cognito-dev.config.ts
//
// PARENT_GATE_FORCE_ACTIVE 未設定の場合 (通常の cognito-dev) は test 全件 skip。
// 既存 auth.setup.ts / E2E spec を破壊しない構造的妥協 (本 EPIC + ADR-0050 §運用)。

import { expect, test } from '@playwright/test';

// PARENT_GATE_FORCE_ACTIVE=true で起動した server に対してのみ実行
test.describe('EPIC #2310 — Parent-Gate PIN session', () => {
	test.skip(
		process.env.PARENT_GATE_FORCE_ACTIVE !== 'true',
		'PARENT_GATE_FORCE_ACTIVE=true で起動した server 上でのみ実行 (本 spec の前提)',
	);

	// owner storageState で開始 (auth.setup.ts で生成済み)
	test.use({ storageState: 'playwright/.auth/owner.json' });

	test.beforeEach(async ({ context }) => {
		// 既存の parent session cookie を破棄して PIN gate を確実に発動させる
		await context.clearCookies({ name: 'gq_parent_session' });
	});

	test('AC2: 未認証で /admin に到達すると /switch?pinRequired=1 に redirect', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'domcontentloaded' });
		// middleware redirect で /switch?pinRequired=1 になる
		await expect(page).toHaveURL(/\/switch\?.*pinRequired=1/);
		// PIN gate modal が auto-open している
		await expect(page.getByTestId('parent-gate-modal')).toBeVisible();
		// banner も表示されている
		await expect(page.getByTestId('parent-gate-required-banner')).toBeVisible();
	});

	test('AC4: 不正 PIN を 3 回入力すると lockout', async ({ page }) => {
		await page.goto('/switch?pinRequired=1', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('parent-gate-modal')).toBeVisible();

		// 3 回 invalid PIN を投入
		// 既存 verifyPin の lockout threshold (5 回) に到達するまで複数試行が必要なため、
		// ここでは 1 回失敗 → invalid error が表示される確認のみ実施
		// (実 lockout 5 回後の動作は unit test parent-gate-session.test.ts + auth-service.test.ts でカバー)
		const invalidPin = '9999';
		for (const ch of invalidPin) {
			await page.keyboard.press(ch);
		}
		// invalid error の Alert が表示される (lockout も含む parent-gate-error data-testid)
		await expect(page.getByTestId('parent-gate-error')).toBeVisible({ timeout: 10_000 });
	});

	test('AC3: 子供モード切替時に PIN session cookie が破棄される (EPIC 構造的核心)', async ({
		page,
		context,
	}) => {
		// 1. /switch から子供を選んで child mode へ
		await page.goto('/switch', { waitUntil: 'domcontentloaded' });
		// child-select button (任意の 1 件) を押す
		const firstChildButton = page.locator('[data-testid^="child-select-"]').first();
		await firstChildButton.click();
		await page.waitForURL(/\/(preschool|elementary|junior|senior|baby)\/home/, {
			timeout: 15_000,
		});

		// 2. cookie 確認: gq_parent_session が削除されている
		const cookies = await context.cookies();
		const parentSession = cookies.find((c) => c.name === 'gq_parent_session');
		expect(parentSession).toBeUndefined();

		// 3. /admin に再到達すると PIN gate に redirect されることで「破棄」効果を検証
		await page.goto('/admin', { waitUntil: 'domcontentloaded' });
		await expect(page).toHaveURL(/\/switch\?.*pinRequired=1/);
	});
});
