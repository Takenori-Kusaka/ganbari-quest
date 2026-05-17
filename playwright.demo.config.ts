// playwright.demo.config.ts
//
// Demo Lambda 環境 (AUTH_MODE=anonymous + DATA_SOURCE=demo) 専用 E2E config (#2205)。
//
// ADR-0048 Multi-Lambda Demo Deployment で導入された demo Lambda (`demo.ganbari-quest.com`)
// 固有の動作 (匿名認証 / Bug 4 `/switch` クリック動作 / marketplace seed 等) を、
// 本番 cognito E2E では検証できないため別 config として分離する。
//
// 実行モード:
//   - ローカル開発:   AUTH_MODE=anonymous DATA_SOURCE=demo の preview server を自動起動 (port 5180)
//   - CI:             同上 (deployed demo Lambda を撃つには DEMO_BASE_URL を指定)
//   - prod 環境検証:  DEMO_BASE_URL=https://demo.ganbari-quest.com npm run test:e2e:demo
//
// PR-B4 (#2204) で hooks.server.ts の demo 検出を env-only に単一化したため、
// 本 config の env (AUTH_MODE=anonymous + DATA_SOURCE=demo) が同時に揃った時のみ
// demo Lambda と同じ判定が走る。片方欠落時は安全側 fallback で sqlite 動作になる。

import { defineConfig, devices } from '@playwright/test';

const DEMO_BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:5180';
const useDeployedTarget = DEMO_BASE_URL.startsWith('https://');

export default defineConfig({
	testDir: './tests/e2e/demo-lambda',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	// demo Lambda は Provisioned Concurrency 1 unit 想定 (ADR-0048 §P-1.2)。
	// それでも cold start / preview server 起動揺らぎを吸収するため CI は 2 retry。
	retries: process.env.CI ? 2 : 0,
	// CI 上は preview server の起動完了タイミング揺らぎを吸収するため 1 worker に固定。
	// ローカルは並列で速く流す。
	workers: process.env.CI ? 1 : 2,
	timeout: 30_000,
	expect: { timeout: 10_000 },
	reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-demo' }]],
	use: {
		baseURL: DEMO_BASE_URL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		actionTimeout: 10_000,
		navigationTimeout: 30_000,
		// #1292: headless Chromium で document.hidden=true になる問題回避 (本番 config と整合)
		launchOptions: {
			args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
		},
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
			},
		},
	],
	// CI 上 prod 環境 (DEMO_BASE_URL=https://...) を叩く場合は webServer 起動しない。
	// それ以外 (ローカル / CI 上で localhost を叩く) は preview server を起動する。
	webServer: useDeployedTarget
		? undefined
		: {
				// AUTH_MODE=anonymous + DATA_SOURCE=demo で demo Lambda と同等の hooks 判定を発火させる。
				// AWS_LICENSE_SECRET は本番 cognito E2E と同じダミー値で良い (AnonymousAuthProvider は
				// licenseStatus=ACTIVE スタブのため署名検証が走らない、src/hooks.server.ts §806 参照)。
				command:
					process.platform === 'win32'
						? 'set AUTH_MODE=anonymous&& set DATA_SOURCE=demo&& set AWS_LICENSE_SECRET=e2e-test-secret-do-not-use-in-production&& npm run preview -- --port 5180'
						: 'AUTH_MODE=anonymous DATA_SOURCE=demo AWS_LICENSE_SECRET=e2e-test-secret-do-not-use-in-production npm run preview -- --port 5180',
				port: 5180,
				reuseExistingServer: !process.env.CI,
				timeout: 60_000,
			},
});
