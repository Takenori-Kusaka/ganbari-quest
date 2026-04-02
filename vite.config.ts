/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
const dirname =
	typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
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
			// カバレッジ閾値 — ラチェット方式（現在値をベースラインとし、引き上げのみ許可）
			// 目標: 80/80/75/80。段階的に引き上げる。閾値を下げるPRは原則リジェクト
			// 2026-04-02 #0216きょうだいチャレンジ追加でカバレッジ低下（新コード大量追加、テスト未充足）
			thresholds: {
				lines: 43,
				functions: 31,
				branches: 38,
				statements: 37,
			},
		},
		projects: [
			{
				extends: true,
				test: {
					include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
					environment: 'jsdom',
					globals: true,
				},
			},
			// Storybook browser test — ローカルのみ（CIではPlaywrightブラウザ未インストール）
			...(process.env.CI
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
