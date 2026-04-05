// playwright.aws.config.ts
// AWS 本番環境（ganbari-quest.com）に対する全 E2E テスト実行用設定
// 実行: E2E_TEST_PASSWORD='xxx' npx playwright test --config playwright.aws.config.ts

import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL を確実にセット — isAwsEnv() が正しく動作するために必須
if (!process.env.E2E_BASE_URL) {
	process.env.E2E_BASE_URL = 'https://ganbari-quest.com';
}

export default defineConfig({
	testDir: 'tests/e2e',
	testIgnore: ['**/cognito-auth.spec.ts', '**/production-smoke.spec.ts'],
	fullyParallel: false,
	retries: 1,
	workers: 1,
	timeout: 60_000,
	reporter: [['list'], ['json', { outputFile: 'test-results/aws.json' }]],
	globalSetup: './tests/e2e/global-setup-aws.ts',
	globalTeardown: './tests/e2e/global-teardown-aws.ts',
	use: {
		baseURL: process.env.E2E_BASE_URL || 'https://ganbari-quest.com',
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		// Cognito 認証済みの storageState を全テストで共有
		storageState: 'tests/e2e/.auth/aws-storage-state.json',
	},
	projects: [
		{
			name: 'aws',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
			},
		},
	],
	// webServer 不要（AWS 環境を直接テスト）
});
