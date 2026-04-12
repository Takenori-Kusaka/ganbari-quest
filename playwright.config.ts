import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	testIgnore: [
		'**/cognito-auth.spec.ts',
		// #776, #779: プラン別ゲート E2E は cognito-dev モード専用
		// （playwright.cognito-dev.config.ts でのみ実行する）
		// local モードでは email/password ログインフォームが存在せず、
		// loginAsPlan() が 180s 待ちで CI を hang させるため必ず除外する
		'**/plan-gated-features.spec.ts',
		'**/plan-standard.spec.ts',
		'**/plan-family.spec.ts',
		'**/production-smoke.spec.ts',
		// ビジュアル回帰テストはプラットフォーム固有のスナップショットを使うため
		// CI（Linux）ではスキップし、ローカル開発でのUI崩壊検知にのみ使用する
		...(process.env.CI ? ['**/visual-regression.spec.ts'] : []),
	],
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : 2,
	timeout: 30_000,
	reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results.json' }]],
	globalSetup: './tests/e2e/global-setup.ts',
	globalTeardown: './tests/e2e/global-teardown.ts',
	use: {
		baseURL: 'http://localhost:5173',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		actionTimeout: 10_000,
		extraHTTPHeaders: {
			Origin: 'http://localhost:5173',
		},
	},
	projects: [
		{
			name: 'tablet',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
			},
		},
		{
			name: 'mobile',
			dependencies: ['tablet'],
			use: {
				...devices['Pixel 7'],
			},
		},
	],
	webServer: {
		command: process.env.CI ? 'npm run preview -- --port 5173' : 'npm run dev',
		port: 5173,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
});
