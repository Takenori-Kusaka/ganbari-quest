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
	// #1500: plan 別 storageState プロジェクトで loginAsPlan() を撤廃
	// #1535: upgrade-checkout を tests/e2e/integration/ に移動
	testMatch:
		/(cognito-auth|plan-gated-features|plan-standard|plan-family|plan-free|premium-welcome|trial-flow|ops-license|ops-license-issue|upgrade-flow|pricing-page-signup|trial-banner-display|account-deletion|integration\/upgrade-checkout)\.spec\.ts$/,
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
		// #1497 / #1500: auth.setup.ts で全 DEV_USERS ロールの storageState を事前保存する。
		// 後続プロジェクトはそれぞれ dependencies: ['setup'] + storageState で認証済み状態から開始。
		{ name: 'setup', testMatch: /auth\.setup\.ts$/ },

		// #1500: plan 別プロジェクト（各 spec が loginAsPlan() を呼ぶ代わりに
		// storageState でセッションを再利用する）
		//
		// spec が期待するユーザーと各プロジェクトの対応:
		//   as-free         → free@example.com    (plan=free)
		//   as-standard     → standard@example.com (plan=standard)
		//   as-family       → family@example.com   (plan=family)
		//   as-trial-expired→ trial-expired@example.com (plan=free, trial 期限切れ)
		//   as-owner        → owner@example.com    (owner ロール、plan=family)
		//   as-ops          → ops@example.com      (ops ロール)
		//
		// #1535: 全対象 spec の loginAsPlan() を storageState ベースに移行完了。
		// 各 spec は test.use({ storageState: '...' }) で認証済みセッションを再利用する。
		{
			name: 'as-owner',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'playwright/.auth/owner.json',
				viewport: { width: 1280, height: 800 },
			},
			testIgnore: [/auth\.setup\.ts$/, /account-deletion\.spec\.ts$/],
		},
		{
			name: 'as-free',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'playwright/.auth/free.json',
				viewport: { width: 1280, height: 800 },
			},
			testIgnore: [/auth\.setup\.ts$/, /account-deletion\.spec\.ts$/],
		},
		{
			name: 'as-standard',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'playwright/.auth/standard.json',
				viewport: { width: 1280, height: 800 },
			},
			testIgnore: [/auth\.setup\.ts$/, /account-deletion\.spec\.ts$/],
		},
		{
			name: 'as-family',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'playwright/.auth/family.json',
				viewport: { width: 1280, height: 800 },
			},
			testIgnore: [/auth\.setup\.ts$/, /account-deletion\.spec\.ts$/],
		},
		{
			name: 'as-trial-expired',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'playwright/.auth/trial-expired.json',
				viewport: { width: 1280, height: 800 },
			},
			testIgnore: [/auth\.setup\.ts$/, /account-deletion\.spec\.ts$/],
		},
		{
			name: 'as-ops',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'playwright/.auth/ops.json',
				viewport: { width: 1280, height: 800 },
			},
			testIgnore: [/auth\.setup\.ts$/, /account-deletion\.spec\.ts$/],
		},
		// #1559: account-deletion は専用プロジェクトで1回のみ実行（6重実行防止）
		// as-* プロジェクト全てで testIgnore に追加し、このプロジェクトのみで実行する。
		// storageState はテスト内の test.use() で describe ごとに指定済み。
		{
			name: 'account-deletion',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
			},
			testMatch: /account-deletion\.spec\.ts$/,
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
