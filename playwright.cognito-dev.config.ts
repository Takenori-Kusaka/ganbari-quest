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
	testMatch:
		/(cognito-auth|plan-gated-features|plan-standard|plan-family|plan-free|premium-welcome|trial-flow)\.spec\.ts$/,
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
		{
			name: 'cognito-dev',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
			},
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
