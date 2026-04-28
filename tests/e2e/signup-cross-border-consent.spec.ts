// tests/e2e/signup-cross-border-consent.spec.ts
// #1638 #1590: signup フォームに「米国（AWS バージニア北部リージョン）への
// 個人データ移転同意」チェックボックスを追加した E2E 検証。
//
// 前提:
//   - signup フォーム自体は AUTH_MODE=cognito かつ COGNITO_DEV_MODE が false の
//     ときのみ実 UI として描画される。local モード / cognito-dev モードでは
//     /auth/signup は /auth/login にリダイレクトされる（src/routes/auth/signup/+page.server.ts）
//   - そのため CI のデフォルト config（AUTH_MODE=local）では本 spec は全て skip
//     され、ロジックの主検証は tests/unit/routes/signup-cross-border-consent.test.ts で行う。
//   - 本 E2E spec は手動 / 本番環境 smoke で AUTH_MODE=cognito を立てて実行する用途。
//
// 検証項目:
//   1. agreedCrossBorder 未チェックでは submit ボタンが disabled
//   2. agreedTerms / agreedPrivacy / agreedCrossBorder の 3 つ全てチェックで enabled
//   3. プライバシーポリシー詳細リンクが新タブ（target=_blank）で開く

import { expect, test } from '@playwright/test';

const authMode = process.env.AUTH_MODE ?? 'local';
const cognitoDevMode = process.env.COGNITO_DEV_MODE === 'true';
// signup フォームが描画されるのは AUTH_MODE=cognito かつ COGNITO_DEV_MODE!=true のときのみ
const canRenderSignupForm = authMode === 'cognito' && !cognitoDevMode;

test.describe('#1638 #1590: signup 域外移転同意チェックボックス', () => {
	test.skip(
		!canRenderSignupForm,
		'AUTH_MODE=cognito + COGNITO_DEV_MODE!=true でのみ実行可能（local / cognito-dev では /auth/signup → /auth/login redirect）',
	);

	test('agreedCrossBorder 未チェックでは submit ボタンが disabled', async ({ page }) => {
		await page.goto('/auth/signup');

		// メール・パスワード・規約・プラポリは入力/チェック済みにする
		await page.locator('input[name="email"]').fill('test@example.com');
		await page.locator('input[name="password"]').fill('TestPass123');
		await page.locator('input[name="passwordConfirm"]').fill('TestPass123');
		await page.locator('input[name="agreedTerms"]').check();
		await page.locator('input[name="agreedPrivacy"]').check();
		// agreedCrossBorder のみ未チェック

		const submitBtn = page.getByTestId('signup-submit-button');
		await expect(submitBtn).toBeDisabled();
	});

	test('agreedTerms / agreedPrivacy / agreedCrossBorder の 3 つ全てチェックで enabled', async ({
		page,
	}) => {
		await page.goto('/auth/signup');

		await page.locator('input[name="email"]').fill('test@example.com');
		await page.locator('input[name="password"]').fill('TestPass123');
		await page.locator('input[name="passwordConfirm"]').fill('TestPass123');
		await page.locator('input[name="agreedTerms"]').check();
		await page.locator('input[name="agreedPrivacy"]').check();
		await page.getByTestId('signup-cross-border-checkbox').check();

		const submitBtn = page.getByTestId('signup-submit-button');
		await expect(submitBtn).toBeEnabled();
	});

	test('プライバシーポリシー詳細リンクが新タブ（target=_blank）で開く', async ({ page }) => {
		await page.goto('/auth/signup');

		// agreedCrossBorder ラベル内の「詳細」リンクを取得
		const detailLink = page
			.locator('label:has(input[data-testid="signup-cross-border-checkbox"])')
			.getByRole('link');

		await expect(detailLink).toHaveAttribute('target', '_blank');
		await expect(detailLink).toHaveAttribute(
			'href',
			'https://www.ganbari-quest.com/privacy.html#cross-border-transfer',
		);
		await expect(detailLink).toHaveAttribute('rel', /noopener/);
	});
});
