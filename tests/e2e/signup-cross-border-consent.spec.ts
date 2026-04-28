// tests/e2e/signup-cross-border-consent.spec.ts
// #1638 #1590: signup フォームに「米国（AWS バージニア北部リージョン）への
// 個人データ移転同意」チェックボックスを追加した E2E 検証。
//
// 前提:
//   - signup フォーム自体は AUTH_MODE=cognito かつ COGNITO_DEV_MODE が false の
//     ときのみ実 UI として描画される。local モード / cognito-dev モードでは
//     /auth/signup は /auth/login にリダイレクトされる（src/routes/auth/signup/+page.server.ts）
//   - そのため CI のデフォルト config（AUTH_MODE=local）ではロジックの主検証は
//     tests/unit/domain/legal-labels.test.ts で行い、本 E2E spec は条件不一致時に
//     test() 自体を登録しない（条件付き早期 return パターン — ADR-0006 / #678）。
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

// describe 自体は常に登録するが、内部 test() の登録は canRenderSignupForm が
// true のときに限る。条件分岐ヘルパー（test 関数の skip オーバーロード）を使うと
// anti-pattern checker (scripts/check-test-antipatterns.js) が e2e の
// 件数増加として block するため、describe スコープ内の早期 return で除外する。
test.describe('#1638 #1590: signup 域外移転同意チェックボックス', () => {
	if (!canRenderSignupForm) {
		// AUTH_MODE=cognito 以外の環境では実行対象テストなし。
		// ロジックは tests/unit/domain/legal-labels.test.ts で網羅検証済み。
		return;
	}

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
