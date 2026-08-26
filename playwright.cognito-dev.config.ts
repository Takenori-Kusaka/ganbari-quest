// playwright.cognito-dev.config.ts
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true でのE2Eテスト
// 実行: npx playwright test --config playwright.cognito-dev.config.ts

import { defineConfig, devices } from '@playwright/test';

/**
 * dev server の port。既定は 5174 (CI / 単独作業ではこれを使う)。
 *
 * #4309: `reuseExistingServer` が有効なため、**別の worktree が 5174 を掴んでいると
 * そちらのコードに対して test が走る**。並列 Agent 環境では「修正済みのはずが fail する」
 * (実測: 未認証 403 を期待した spec が他 worktree の未修正 server に当たり 200 で fail) という
 * 原因の分かりにくい偽 fail になるため、port を env で逃がせるようにする。
 */
const PORT = Number(process.env.E2E_COGNITO_PORT ?? 5174);

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
	// #2346 / #2347 (EPIC #2345): stripe-checkout-labels / stripe-checkout-monthly-yearly を追加
	//   (景表法対応 + 月額/年額切替 + 年額表示強化、test.use({ storageState: 'playwright/.auth/free.json' }) 使用)
	// #4309: ops-export-authz を追加（/ops 配下 API の認可を実 HTTP 経路で回帰検証。
	//   未認証 / 非 ops → 403、ops → 認可通過。cognito-dev でないと ops group を再現できない）
	// #4703: viewer-link-page を追加（family 限定の閲覧リンク発行 → 未ログイン別 context で
	//   /view/<token> を開く。family plan と認証済み API 呼び出しが要るので cognito-dev 側）
	testMatch:
		/(cognito-auth|ops-export-authz|plan-gated-features|plan-standard|plan-family|plan-free|premium-welcome|trial-flow|ops-license|ops-license-issue|upgrade-flow|pricing-page-signup|trial-banner-display|account-deletion|notification-permission-banner|parent-gate|viewer-link-page|integration\/upgrade-checkout|integration\/stripe-checkout-labels|integration\/stripe-checkout-monthly-yearly)\.spec\.ts$/,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 1,
	workers: 1,
	timeout: 60_000,
	reporter: [['list'], ['html', { open: 'never' }]],
	globalSetup: './tests/e2e/global-setup.ts',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
	},
	projects: [
		// #1497 / #1500: auth.setup.ts で全 DEV_USERS ロールの storageState を事前保存する。
		// 後続プロジェクトはそれぞれ dependencies: ['setup'] + storageState で認証済み状態から開始。
		{ name: 'setup', testMatch: /auth\.setup\.ts$/ },

		// #1535: 6プロジェクト → chromium 1プロジェクトに集約してタイムアウト解消。
		// 各 spec が test.use({ storageState: '...' }) で describe/spec レベルのstorageStateを指定するため、
		// プロジェクトレベルの storageState は不要。全 spec を1回だけ実行する。
		{
			name: 'chromium',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
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
				? `set AUTH_MODE=cognito&& set COGNITO_DEV_MODE=true&& npm run preview -- --port ${PORT}`
				: `AUTH_MODE=cognito COGNITO_DEV_MODE=true npm run preview -- --port ${PORT}`
			: process.platform === 'win32'
				? `set AUTH_MODE=cognito&& set COGNITO_DEV_MODE=true&& npm run dev -- --port ${PORT}`
				: `AUTH_MODE=cognito COGNITO_DEV_MODE=true npm run dev -- --port ${PORT}`,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});
