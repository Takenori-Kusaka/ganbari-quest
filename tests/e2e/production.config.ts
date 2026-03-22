import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testMatch: '**/production-smoke.spec.ts',
	fullyParallel: false,
	retries: 1,
	workers: 1,
	reporter: [['list']],
	use: {
		baseURL: 'https://ganbari-quest.com',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'production',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
			},
		},
	],
});
