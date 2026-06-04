// tests/e2e/plan-gated-features.spec.ts
// #776: プラン別ゲート UI の E2E 検証
//
// ローカル auth モードでは plan-limit-service の resolvePlanTier が
// 早期 return で常に 'family' を返すため、プランゲートを E2E で検証できない。
// この spec は AUTH_MODE=cognito + COGNITO_DEV_MODE=true 前提で実行し、
// DevCognitoAuthProvider のプラン別ダミーユーザー（free/standard/family）で
// ログイン → 実際のプランゲート UI を検証する。
//
// #1535: loginAsPlan() を storageState ベースに移行（describe ブロック分割）
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-gated-features
//
// 対応ゲート:
//  - /admin/rewards: rewards-upgrade-banner（free のみ表示）
//
// #2316 削除済 ゲート:
//  - /admin/messages: ひとことメッセージボタン (free/standard disabled, family enabled)
//    → #2267 (PR #2293) で /admin/messages 廃止 + /admin/cheer 統合により、
//      メッセージ機能は応援機能の付随要素として全プラン解放された
//      (ADR-0006 assertion erosion ban に従い skip ではなく削除)

import { expect, test } from '@playwright/test';

// ============================================================
// /admin/rewards — #728 カスタムごほうびプランゲート
// ============================================================
test.describe('#776 /admin/rewards プランゲート — free', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free プランではアップグレードバナーが表示される', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toBeVisible();
		await expect(page.getByTestId('rewards-upgrade-cta')).toBeVisible();
	});

	// #2894 AC5: free tier の reward-set 取込 → PlanLimitError が正しく描画される。
	// 根本原因 (#2894): `String(error)` で PlanLimitError オブジェクトが `[object Object]` 化し、
	// 「件数表示すら正しくない」壊れた表示になっていた。getActionErrorDisplay 経由で
	// 構造化メッセージ + アップグレード導線が出ることを検証する (NN/G #9 error recovery)。
	test('free プランで reward-set 取込 → PlanLimitError 構造化メッセージ + upgrade 導線 (#2894 AC3)', async ({
		page,
	}) => {
		test.slow(); // Vite dev コールドコンパイル耐性

		// ?import=<presetId> で ChildSelectionDialog auto-open
		await page.goto('/admin/rewards?import=kinder-rewards', { waitUntil: 'domcontentloaded' });
		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 15_000 });

		// 「全員に追加」default → 確定 click。free tier は importPresetToChildren で 403 を返す。
		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm.click(),
		]);
		// SvelteKit form action の fail(403) は ActionResult として body 内 error を返す。
		expect(resp.ok()).toBeTruthy();

		// banner が表示され、`[object Object]` でない構造化メッセージが出る (壊れ表示の根治検証)。
		const banner = page.getByTestId('rewards-action-message');
		await expect(banner).toBeVisible({ timeout: 10_000 });
		await expect(banner).not.toContainText('[object Object]');
		// PlanLimitError メッセージ (UPGRADE_MESSAGE = PLAN_GATE_LABELS.standardOrAboveFor) を含む。
		await expect(banner).toContainText('スタンダードプラン');

		// AC3 / NN/G #9: アップグレード導線リンクが /admin/subscription へ向く。
		const upgradeLink = page.getByTestId('rewards-upgrade-link');
		await expect(upgradeLink).toBeVisible();
		await expect(upgradeLink).toHaveAttribute('href', '/admin/subscription');
	});
});

test.describe('#776 /admin/rewards プランゲート — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランではアップグレードバナーが表示されない', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
	});

	// #2894 AC5: paid tier (standard) は reward-set 取込が成功し一覧に反映される
	// (free の 403 と対になる positive case)。upgrade 導線は出ない。
	test('standard プランで reward-set 取込 → 成功 + upgrade 導線なし (#2894 AC5)', async ({
		page,
	}) => {
		test.slow();

		await page.goto('/admin/rewards?import=kinder-rewards', { waitUntil: 'domcontentloaded' });
		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 15_000 });

		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm.click(),
		]);
		expect(resp.ok()).toBeTruthy();

		// 成功 banner が出て `[object Object]` も upgrade 導線も出ない。
		const banner = page.getByTestId('rewards-action-message');
		await expect(banner).toBeVisible({ timeout: 10_000 });
		await expect(banner).not.toContainText('[object Object]');
		await expect(banner).not.toContainText('スタンダードプラン以上');
		await expect(page.getByTestId('rewards-upgrade-link')).toHaveCount(0);
	});
});

test.describe('#776 /admin/rewards プランゲート — family', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランではアップグレードバナーが表示されない', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
	});
});

// ============================================================
// /admin/challenges — #2402 QM must-3 (OWASP A01) challenge-set import family ゲート
// ============================================================
// 兄弟チャレンジは family-only 機能。client-side `{#if !isFamily}` UI ゲートを
// 直接 POST でバイパスできないよう、サーバー側でも family プラン厳密比較を実施。
//
// **検証層**: unit テスト (`tests/unit/routes/admin-challenges-marketplace-import-plan-gate.test.ts`)
// で action handler を直接呼び出して検証する。
//
// E2E (`request.post`) で同等の検証を試みたところ、SvelteKit の CSRF 保護
// (`Cross-site POST form submissions are forbidden`) が family ゲートに到達する前に
// レスポンスを差し替えるため、E2E 層で gate メッセージを assert できない問題があった
// (PR #2402 e2e-cognito-dev failure)。
// unit テストで action handler を直接呼ぶことで CSRF を回避しつつ、ADR-0006 に従い
// 403 family gate の assertion 強度は維持する (検証層を移動するだけで弱体化させない)。
