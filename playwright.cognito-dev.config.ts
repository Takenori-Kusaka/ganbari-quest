// playwright.cognito-dev.config.ts
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true でのE2Eテスト
// 実行: npx playwright test --config playwright.cognito-dev.config.ts

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	// #776: plan-gated-features spec も cognito-dev モードでのみ実行可能
	// （local モードでは resolvePlanTier が常に 'family' を返すため）
	// #779: plan-standard / plan-family の機能疎通 spec を追加
	// #751: plan-free の機能ゲート spec を追加
	// #778: premium-welcome モーダルの初回表示・dismiss spec を追加
	// #752: trial-flow のトライアルライフサイクル spec を追加
	// #805: ops-license / ops-license-issue を追加（ops group 認可テスト）
	// #753: upgrade-flow のアップグレード導線 spec を追加
	// #757: pricing-page-signup のトライアル自動開始 spec を追加
	// #750: trial-banner-display / account-deletion を追加
	// #755: account-deletion のアカウント削除フロー spec を追加
	// #1497: upgrade-checkout の Stripe Checkout インターセプト spec を追加
	testMatch:
		/(cognito-auth|plan-gated-features|plan-standard|plan-family|plan-free|premium-welcome|trial-flow|ops-license|ops-license-issue|upgrade-flow|pricing-page-signup|trial-banner-display|account-deletion|upgrade-checkout)\.spec\.ts$/,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 1,
	workers: 1,
	timeout: 60_000,
	reporter: [['list'], ['html', { open: 'never' }]],
	globalSetup: './tests/e2e/global-setup.ts',
	use: {
		baseURL: 'http://localhost:5174',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
	},
	projects: [
		// #1497: storageState によるログイン高速化
		// auth.setup.ts で 3 ロール分のセッションをキャッシュしてから本テストを実行
		{ name: 'setup', testMatch: /auth\.setup\.ts$/ },
		{
			name: 'cognito-dev',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'playwright/.auth/owner.json',
				viewport: { width: 1280, height: 800 },
			},
			testIgnore: /auth\.setup\.ts$/,
		},
	],
	webServer: {
		command: process.env.CI
			? process.platform === 'win32'
				? 'set AUTH_MODE=cognito&& set COGNITO_DEV_MODE=true&& npm run preview -- --port 5174'
				: 'AUTH_MODE=cognito COGNITO_DEV_MODE=true npm run preview -- --port 5174'
			: process.platform === 'win32'
				? 'set AUTH_MODE=cognito&& set COGNITO_DEV_MODE=true&& npm run dev -- --port 5174'
				: 'AUTH_MODE=cognito COGNITO_DEV_MODE=true npm run dev -- --port 5174',
		port: 5174,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});
