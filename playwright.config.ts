import { defineConfig, devices } from '@playwright/test';

// local モード共通で除外するスペック。mobile project の testIgnore もこれを継承する
// （Playwright は project 側 testIgnore が top-level を override するため、
//  mobile 側でこの配列を include してから追加除外ファイルを足す必要がある）。
const BASE_TEST_IGNORE = [
	// #2205: demo Lambda 専用 spec (AUTH_MODE=anonymous + DATA_SOURCE=demo 必須)。
	// 本 config (local モード) では認証フローが異なり、`/switch` POST が demo no-op 化されないため
	// 全 spec FAIL する。必ず `playwright.demo.config.ts` 経由で起動する。
	'**/demo-lambda/**',
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
	// #2115 / #2116: NotificationPermissionBanner E2E は cognito-dev モード専用
	// (storageState=playwright/.auth/standard.json を使い /admin/* に到達する)
	'**/notification-permission-banner.spec.ts',
	// #752: トライアルフロー E2E は cognito-dev モード専用
	'**/trial-flow.spec.ts',
	// #805: /ops E2E は cognito-dev モード専用（ops group の認可テストに email/password ログインが必要）
	'**/ops-license.spec.ts',
	'**/ops-license-issue.spec.ts',
	// #2484: /ops/license/legacy-count endpoint E2E も同様 cognito-dev モード専用
	'**/ops-license-legacy-count.spec.ts',
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
	// #2346 / #2347 (EPIC #2345): Stripe Checkout 景表法対応 + 月額/年額切替 E2E は
	// cognito-dev モード専用 (test.use({ storageState: 'playwright/.auth/free.json' }) を使用、
	// auth.setup.ts が cognito-dev config の setup project でのみ走るため local config では fixture 不在 ENOENT)
	'**/integration/stripe-checkout-labels.spec.ts',
	'**/integration/stripe-checkout-monthly-yearly.spec.ts',
	// #1598 PR #1675: スクリーンショット撮影専用 spec (cognito-dev mode 専用、CI 既定実行から除外)
	'**/screenshots-pmf-survey.spec.ts',
	'**/production-smoke.spec.ts',
	// ビジュアル回帰テストはプラットフォーム固有のスナップショットを使うため
	// CI（Linux）ではスキップし、ローカル開発でのUI崩壊検知にのみ使用する
	...(process.env.CI ? ['**/visual-regression.spec.ts'] : []),
];

// #2648 Phase A Step A-4: per-worker SQLite file isolation 完成。
// WORKER_COUNT=2 に増やし、各 webServer に env.DATABASE_URL=`./data/e2e-worker-${i}.db` を注入。
// global-setup.ts が template (data/ganbari-quest.db) を作成後、helpers/per-worker-db.ts 経由で
// 各 worker DB を `db.backup()` で複製済の前提 (WAL/shm 整合 snapshot)。
//
// BASE_PORT=5190 は本番 (5173) / cognito-dev (5174) / demo Lambda (5180) / matrix (5201-5205) と被らない。
// (Step A-1 初回 5180 採用 → demo Lambda preview server (`playwright.demo.config.ts:68`) と衝突して
// `reuseExistingServer: !CI` 経由で demo モード server に hit され `/switch` 動作異常を起こした学びから 5190 へ修正)
//
// global-setup.ts 側の WORKER_COUNT と一致させること (現状: 両方 2)。
// Phase B / Phase D で 4 復帰判断。
const WORKER_COUNT = 2;
const BASE_PORT = 5190;

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
	//
	// #2648 Phase A Step A-1 (一時退行): WORKER_COUNT=1 で webServer 配列化動作確認のみ。
	// CI 時間は 6m → 12m+ に一時退行するが Step A-4 で per-worker DB isolation を導入して
	// WORKER_COUNT=2 に戻し、Phase 2 で 5 age mode 全部 per-worker 化後 workers=4 復帰判断する。
	workers: WORKER_COUNT,
	timeout: 30_000,
	// CI shard 時は blob reporter で結果を個別出力し、merge-reports で集約する。
	// ローカル / 非 shard CI では従来の list + html + json を維持。
	reporter: process.env.CI
		? [['blob', { outputDir: 'blob-report' }], ['list']]
		: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results.json' }]],
	globalSetup: './tests/e2e/global-setup.ts',
	globalTeardown: './tests/e2e/global-teardown.ts',
	use: {
		// #2648 Phase A Step A-1: BASE_PORT (5180) で webServer 配列起動。
		// WORKER_COUNT=1 のため第 1 worker (port 5180) を全 test が使用。
		// 全 worker が異なる port を使う Step A-4 では worker fixture で動的化する。
		baseURL: `http://localhost:${BASE_PORT}`,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		actionTimeout: 10_000,
		extraHTTPHeaders: {
			Origin: `http://localhost:${BASE_PORT}`,
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
			testIgnore: [
				...BASE_TEST_IGNORE,
				'**/tutorial-dialog-primitive-screenshots.spec.ts',
				// #2393: 子供画面 tutorial spec は tablet 固定 (1280x800 で撮影 + dialog 検証)
				'**/child-tutorial-dialog-screenshots.spec.ts',
				'**/child-tutorial-double-dialog-regression.spec.ts',
				'**/child-tutorial-verification.spec.ts',
			],
			use: {
				...devices['Pixel 7'],
			},
		},
	],
	// #2648 Phase A Step A-4: per-worker SQLite file isolation 完成。
	// WORKER_COUNT=2 で 2 server 起動 (port 5190 / 5191)。
	// 各 server に env.DATABASE_URL=`./data/e2e-worker-${i}.db` を注入し
	// global-setup.ts が事前に `db.backup()` 複製した worker DB だけを touch させる。
	// SvelteKit (`src/lib/server/db/client.ts:12`) は `process.env.DATABASE_URL ?? './data/ganbari-quest.db'`
	// で接続するため env 注入で自然に振り分けられる。
	//
	// 注意: Step A-6 時点では pin-activity.spec.ts のみが `fixtures.ts` 経由で
	// `workerBaseURL` (`http://localhost:${BASE_PORT + parallelIndex}`) を読む。
	// 他 spec は引き続き `use.baseURL` (= port 5190) を使うため事実上 worker[0] にのみ
	// 振り分けられる (Phase B で順次 fixtures 経由に切替予定)。
	webServer: Array.from({ length: WORKER_COUNT }, (_, i) => ({
		command: process.env.CI
			? `npm run preview -- --port ${BASE_PORT + i}`
			: `npm run dev -- --port ${BASE_PORT + i}`,
		port: BASE_PORT + i,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
		env: {
			DATABASE_URL: `./data/e2e-worker-${i}.db`,
		},
		// #2648 Round 10 (debug 一時): preview server の stdout/stderr を CI 出力に出すため
		// pipe を有効化。Round 11 で revert する。これにより client.ts module load 時の
		// `[client.ts] PID=... DATABASE_URL=... children count=...` log が CI log に出る。
		// H-3 (env merge fail) / H-1 (schema cache invalidation) の判定に使う。
		stdout: 'pipe',
		stderr: 'pipe',
	})),
});
