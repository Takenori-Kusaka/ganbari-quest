/**
 * ADR-0040 P5 (#1221): mode × plan マトリクス専用 Playwright config。
 *
 * 5 つの実行モード × プラン / ライセンス状態の組合せで smoke test を走らせ、
 * 3 層アーキテクチャ（env.ts → evaluation-context.ts → capabilities.ts）が
 * 境界条件で破綻しないことを機械検証する。
 *
 * ## 使い方
 *
 * ```bash
 * npm run test:e2e:matrix
 * # または単一 project のみ:
 * npx playwright test --config playwright.matrix.config.ts --project=nuc-prod-license-expired
 * ```
 *
 * ## 注意
 *
 * - 5 つの dev server を port 5201-5205 で同時起動するため、起動に 30-60 秒程度かかる
 * - デフォルト CI には含めない（追加時は e2e-test ジョブのタイムアウトを要確認）
 * - DEBUG_* env の上書きは `dev === true` でのみ効く（ADR-0029 safety）
 */
import { defineConfig, devices } from '@playwright/test';

const MATRIX_SPEC = 'adr-0040/matrix.spec.ts';

type Scenario = {
	project: string;
	port: number;
	env: Record<string, string>;
	description: string;
};

const SCENARIOS: readonly Scenario[] = [
	{
		project: 'demo-free',
		port: 5201,
		env: { APP_MODE: 'demo' },
		description: 'mode=demo → write.db 系は常に deny',
	},
	{
		project: 'local-debug-family',
		port: 5202,
		env: { APP_MODE: 'local-debug', DEBUG_PLAN: 'family' },
		description: 'mode=local-debug × plan=family → invite.family_member allowed',
	},
	{
		project: 'aws-prod-trial-expired',
		port: 5203,
		env: { APP_MODE: 'aws-prod', DEBUG_TRIAL: 'expired' },
		description: 'mode=aws-prod × trial=expired → upgrade CTA 表示',
	},
	{
		project: 'nuc-prod-license-valid',
		port: 5204,
		env: { APP_MODE: 'nuc-prod', DEBUG_LICENSE_KEY_VALID: 'true' },
		description: 'mode=nuc-prod × license=valid → write.db allowed',
	},
	{
		project: 'nuc-prod-license-expired',
		port: 5205,
		env: { APP_MODE: 'nuc-prod', DEBUG_LICENSE_KEY_VALID: 'false' },
		description: 'mode=nuc-prod × license=invalid → write.db denies with license-key-invalid',
	},
] as const;

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: `**/${MATRIX_SPEC}`,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 1,
	timeout: 45_000,
	reporter: [['list']],
	globalSetup: './tests/e2e/global-setup.ts',
	globalTeardown: './tests/e2e/global-teardown.ts',
	use: {
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		actionTimeout: 10_000,
	},
	projects: SCENARIOS.map((s) => ({
		name: s.project,
		metadata: { description: s.description, env: s.env },
		use: {
			...devices['Desktop Chrome'],
			viewport: { width: 1280, height: 800 },
			baseURL: `http://localhost:${s.port}`,
			extraHTTPHeaders: { Origin: `http://localhost:${s.port}` },
		},
	})),
	webServer: SCENARIOS.map((s) => ({
		command: `npm run dev -- --port ${s.port}`,
		port: s.port,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
		env: s.env,
	})),
});
