import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		// sharp はネイティブモジュール — バンドルせず node_modules から直接ロード
		external: ['sharp'],
	},
	test: {
		include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
		environment: 'jsdom',
		globals: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
			include: ['src/lib/**/*.ts', 'src/lib/**/*.svelte'],
			exclude: ['src/lib/**/*.d.ts', 'src/lib/**/index.ts'],
			// カバレッジ閾値 — ラチェット方式（現在値をベースラインとし、引き上げのみ許可）
			// 目標: 80/80/75/80。段階的に引き上げる。閾値を下げるPRは原則リジェクト
			// 2026-04-01 Phase5完了ラチェットアップ（実測: stmts 43.31, branch 41.99, funcs 37.10, lines 48.54）
			thresholds: {
				lines: 48,
				functions: 37,
				branches: 41,
				statements: 43,
			},
		},
	},
});
