// playwright.production.config.ts
// 本番環境（ganbari-quest.com）に対するスモークテスト用設定
// 実行: npx playwright test --config playwright.production.config.ts

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: 'production-smoke.spec.ts',
	fullyParallel: false,
	retries: 1,
	workers: 1,
	timeout: 60_000,
	reporter: [['list'], ['json', { outputFile: 'test-results/production.json' }]],
	use: {
		baseURL: process.env.E2E_BASE_URL || 'https://ganbari-quest.com',
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'production-smoke',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
			},
		},
	],
	// webServer 不要（本番環境を直接テスト）
});
