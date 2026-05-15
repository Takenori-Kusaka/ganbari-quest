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
			// git worktree (`tmp/wt-XXXX/`) で起動した時、Vite の dev server fs.allow が
			// worktree 配下に絞られるため、親リポジトリ root の node_modules
			// (`@sveltejs/kit/src/runtime/client/entry.js` 等) が読めず hydration JS が
			// 落ちる。client hydration が動かないと bind:value も発火せず、ログイン
			// フォーム等の disabled ボタンが永久に有効化されない (#1603 で発覚)。
			// 親 1〜2 階層分 (tmp/wt-XXXX/ の場合 ../ と ../../) の node_modules を許可する。
			allow: [path.join(dirname, '..'), path.join(dirname, '..', '..')],
		},
	},
	ssr: {
		// sharp はネイティブモジュール — バンドルせず node_modules から直接ロード
		external: ['sharp'],
	},
	test: {
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
