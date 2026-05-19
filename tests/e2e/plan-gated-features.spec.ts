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
});

test.describe('#776 /admin/rewards プランゲート — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランではアップグレードバナーが表示されない', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
	});
});

test.describe('#776 /admin/rewards プランゲート — family', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランではアップグレードバナーが表示されない', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
	});
});
