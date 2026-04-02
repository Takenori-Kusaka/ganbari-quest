import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

/**
 * ESLint 設定 — Svelte スタイル強制ルール専用
 *
 * JS/TS の lint は Biome が担当。
 * この設定は Svelte ファイルに対する UI 品質ルールのみを扱う。
 */
export default [
	// Svelte ファイルのみ対象
	{
		files: ['src/**/*.svelte'],
		plugins: {
			svelte,
		},
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tsParser,
			},
		},
		rules: {
			// --- デザインシステム強制ルール ---

			// style="" 属性の使用を警告（動的バインディング style:prop={val} は許容）
			// 段階的に error に昇格予定（既存コードの置換完了後）
			'svelte/no-inline-styles': ['warn', { allowTransitions: true }],
		},
	},
];
