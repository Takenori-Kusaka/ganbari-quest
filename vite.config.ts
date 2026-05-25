/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname =
	typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		fs: {
			// git worktree (`tmp/wt-XXXX/` または `.claude/worktrees/<name>/`) で起動した時、
			// Vite の dev server fs.allow が worktree 配下に絞られるため、親リポジトリ root の
			// node_modules (`@sveltejs/kit/src/runtime/client/entry.js` 等) が読めず hydration JS が
			// 落ちる。client hydration が動かないと bind:value も発火せず、ログイン
			// フォーム等の disabled ボタンが永久に有効化されない (#1603 で発覚)。
			// 親 1〜3 階層分 (`tmp/wt-XXXX/` は 2、`.claude/worktrees/<name>/` は 3 階層) の
			// node_modules を許可する。
			allow: [
				path.join(dirname, '..'),
				path.join(dirname, '..', '..'),
				path.join(dirname, '..', '..', '..'),
			],
		},
	},
	ssr: {
		// sharp はネイティブモジュール — バンドルせず node_modules から直接ロード
		external: ['sharp'],
	},
	test: {
		// #2476 vitest 並列実行 SSOT — band-aid (`vi.setConfig({ testTimeout })`) 構造的負債の根本対処
		// 公式 docs (vitest.dev/config/isolate, vitest.dev/config/fileparallelism, vitest.dev/guide/parallelism):
		//   - `isolate: true` (default) の場合、pool 種別 (forks/threads) によらず test file ごとに worker を
		//     新規生成 + 終了し module cache を再利用しない (DeepWiki vitest-dev/vitest 確認)
		//   - つまり pool 切替では transform / import 量は減らない (Issue #2460 verification 実測:
		//     pool:'threads' + maxThreads:8 でも `cron-idempotency` / `marketplace/strategies/*` /
		//     `analytics-service` 等 4-5 件で 5000ms timeout flake 残存)
		// 観察: vitest 4.x default `pool: 'forks'` では 16 fork 並列実行下、SvelteKit + barrel-eager-load
		//   (`src/lib/marketplace/index.ts` 等) + dynamic import の transform を全 fork で再実行し、
		//   並列 CPU / I/O 競合で個別 file が timeout に達する
		// 根本対処: `fileParallelism: false` で test file を直列実行 (各 file 内 `test.concurrent` 並列は可能)。
		//   公式 docs「When disabled, it will override maxWorkers option to 1」+ 「shared external resource
		//   (DB 等) で推奨」が本プロジェクト構造 (SQLite 共有) と完全一致
		// pool: 'forks' (default) を維持: `pool: 'threads'` は worker_threads 制約で `aws-cdk-lib` bundler の
		//   child_process spawn が失敗 (WritableWorkerStdio is invalid stdio)、`multi-lambda-cdk.test.ts` 等が落ちる
		// 実測 (#2476): transform 99s→11s (89% 削減) / import 375s→89s (76% 削減) / tests 0 failed
		// トレードオフ: wall time 92s → 643s (約 7x)、Pre-PMF Bucket A で「test 信頼性 > CI 時間」採用
		fileParallelism: false, // test file 直列実行 (公式 docs: maxWorkers=1 強制、shared DB 推奨)
		testTimeout: 5_000, // default 明示 — 個別 `vi.setConfig({ testTimeout })` band-aid を撤去
		hookTimeout: 10_000,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
			include: ['src/lib/**/*.ts', 'src/lib/**/*.svelte'],
			exclude: ['src/lib/**/*.d.ts', 'src/lib/**/index.ts'],
			// カバレッジ閾値 — ラチェット方式（CI で引き下げを自動拒否: scripts/check-coverage-threshold.js）
			// 目標: 80/80/75/80。段階的に引き上げる。閾値を下げる PR は CI が自動ブロック
			// 2026-04-03 現状ベースライン。テスト改善PR (#679, #680) マージ後に引き上げ
			thresholds: {
				lines: 38,
				functions: 27,
				branches: 35,
				statements: 32,
			},
		},
		projects: [
			{
				extends: true,
				// #777: @testing-library/svelte を使う tests/unit/components 以下のテストで
				// Svelte 5 の client/server エントリを正しく解決するため、svelteTesting() を適用。
				// jsdom + resolve.conditions=['browser'] がセットで必要。
				plugins: [svelteTesting()],
				test: {
					include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
					environment: 'jsdom',
					globals: true,
				},
			},
			// Storybook browser test — 明示的 opt-in（STORYBOOK_TESTS=true）時のみ有効。
			// ローカルの `npx vitest run` は既定で skip。`npm run test:storybook` で opt-in。
			// CI では `.github/workflows/ci.yml` の `storybook-test` ジョブが
			// `STORYBOOK_TESTS=true` を設定して起動する（通常の `unit-test` は既定どおり skip）。
			// #1168: 並列実行時にChromium接続が不安定で周辺テストを巻き添え timeout させていたため、
			// 明示指定なしでは起動しない方針に変更。
			...(process.env.STORYBOOK_TESTS !== 'true'
				? []
				: [
						{
							extends: true as const,
							plugins: [
								storybookTest({
									configDir: path.join(dirname, '.storybook'),
								}),
							],
							test: {
								name: 'storybook',
								browser: {
									enabled: true,
									headless: true,
									provider: playwright({}),
									instances: [{ browser: 'chromium' as const }],
								},
							},
						},
					]),
		],
	},
});
