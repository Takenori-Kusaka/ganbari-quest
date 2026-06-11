/**
 * ADR-0040 P5 (#1221): mode × plan マトリクス専用 Playwright config。
 *
 * 4 つの実行モード × プラン状態の組合せで smoke test を走らせ、
 * 3 層アーキテクチャ（env.ts → evaluation-context.ts → capabilities.ts）が
 * 境界条件で破綻しないことを機械検証する。
 *
 * #2813 (Epic #2525 Phase 7 PR-L2): license key 全廃に伴い nuc-prod の
 * license valid/invalid 2 project を「nuc-prod 信頼ベース write 可能」1 project に統合。
 * NUC は `DEBUG_LICENSE_KEY_VALID` env 無しで常に write 可能であることを smoke で担保する
 * (phase1-nuc FR-2 / US-N3 = license key 撤廃で NUC が記録不能にならない保証)。
 *
 * ## 使い方
 *
 * ```bash
 * npm run test:e2e:matrix
 * # または単一 project のみ:
 * npx playwright test --config playwright.matrix.config.ts --project=nuc-prod-trust-based
 * ```
 *
 * ## 注意
 *
 * - 4 つの dev server を port 5201-5204 で同時起動するため、起動に 30-60 秒程度かかる
 * - CI 組込済 (#2874): `.github/workflows/ci.yml` の `e2e-matrix` job が重量レーン
 *   (main 向け PR = 統合 PR / hotfix + main push) で実行する。develop 向け PR では skip。
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
		project: 'nuc-prod-trust-based',
		port: 5204,
		env: { APP_MODE: 'nuc-prod' },
		description: 'mode=nuc-prod → 信頼ベースで write.db 常時 allowed (license key 撤廃、#2813)',
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
		// #2874: CI runner で dev server 4 本同時起動すると 60s では cold start が間に合わず
		// flake するため 120s に拡張 (server 起動待ちの上限であり、test assertion の
		// timeout / retries:0 は不変 = ADR-0006 assertion 弱体化に非該当)。
		timeout: 120_000,
		env: s.env,
	})),
});
