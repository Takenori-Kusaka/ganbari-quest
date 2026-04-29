import { defineConfig, devices } from '@playwright/test';

// local モード共通で除外するスペック。mobile project の testIgnore もこれを継承する
// （Playwright は project 側 testIgnore が top-level を override するため、
//  mobile 側でこの配列を include してから追加除外ファイルを足す必要がある）。
const BASE_TEST_IGNORE = [
	'**/cognito-auth.spec.ts',
	// #776, #779, #751, #778: プラン別ゲート E2E は cognito-dev モード専用
	// （playwright.cognito-dev.config.ts でのみ実行する）
	// local モードでは email/password ログインフォームが存在せず、
	// loginAsPlan() が 180s 待ちで CI を hang させるため必ず除外する
	'**/plan-gated-features.spec.ts',
	'**/plan-standard.spec.ts',
	'**/plan-family.spec.ts',
	'**/plan-free.spec.ts',
	'**/premium-welcome.spec.ts',
	// #752: トライアルフロー E2E は cognito-dev モード専用
	'**/trial-flow.spec.ts',
	// #805: /ops E2E は cognito-dev モード専用（ops group の認可テストに email/password ログインが必要）
	'**/ops-license.spec.ts',
	'**/ops-license-issue.spec.ts',
	// #753: upgrade-flow E2E は cognito-dev モード専用（loginAsPlan でプラン別ユーザーにログインする）
	'**/upgrade-flow.spec.ts',
	// #757: pricing → signup トライアル自動開始 E2E は cognito-dev モード専用
	'**/pricing-page-signup.spec.ts',
	// #750: 以下は cognito-dev モード専用（loginAsPlan を使用）
	'**/trial-banner-display.spec.ts',
	// #755: アカウント削除 E2E は cognito-dev モード専用（loginAsPlan が Cognito ログインフォームに依存）
	'**/account-deletion.spec.ts',
	// #1497: Stripe Checkout インターセプト E2E は cognito-dev モード専用（loginAsPlan を使用）
	'**/upgrade-checkout.spec.ts',
	// #1598 PR #1675: スクリーンショット撮影専用 spec (cognito-dev mode 専用、CI 既定実行から除外)
	'**/screenshots-pmf-survey.spec.ts',
	'**/production-smoke.spec.ts',
	// ビジュアル回帰テストはプラットフォーム固有のスナップショットを使うため
	// CI（Linux）ではスキップし、ローカル開発でのUI崩壊検知にのみ使用する
	...(process.env.CI ? ['**/visual-regression.spec.ts'] : []),
];

export default defineConfig({
	testDir: 'tests/e2e',
	testIgnore: BASE_TEST_IGNORE,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// #923 Phase 1: workers を 1 → 2 に引き上げて CI 時間を 12m → ~6m に短縮。
	// 当初 4 で試したが pin-activity.spec.ts (DB 書き込み + ダイアログ click race)
	// が 2 連続実行のうち 1 度 flake したため 2 に降格。
	// fullyParallel: true は維持。さらなる短縮は次フェーズ（shard / DB 分離）で。
	// CI / ローカルとも同値のため三項演算子は不要（意図せず差を入れる事故防止）。
	workers: 2,
	timeout: 30_000,
	// CI shard 時は blob reporter で結果を個別出力し、merge-reports で集約する。
	// ローカル / 非 shard CI では従来の list + html + json を維持。
	reporter: process.env.CI
		? [['blob', { outputDir: 'blob-report' }], ['list']]
		: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results.json' }]],
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
		// #1292: headless Chromium では document.hidden が true になり自動スリープ E2E が失敗する。
		// --disable-renderer-backgrounding でバックグラウンドタブ throttling を無効化し
		// document.hidden を false に保つ。全テストへの副作用は軽微（背景タブの優先度制御のみ）。
		launchOptions: {
			args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
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
			// #1192: tablet 固定のスクショ E2E は mobile では実行しない。
			// Playwright は project 側 testIgnore が top-level を override するため、
			// BASE_TEST_IGNORE を include した上で追加ファイルを足す必要がある。
			testIgnore: [...BASE_TEST_IGNORE, '**/tutorial-dialog-primitive-screenshots.spec.ts'],
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
