// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook';

import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import noStyleAttribute from './eslint-plugin-local/no-style-attribute.js';

/**
 * ESLint 設定 — Svelte スタイル強制ルール専用
 *
 * JS/TS の lint は Biome が担当。
 * この設定は Svelte ファイルに対する UI 品質ルールのみを扱う。
 */
export default [
	// Svelte ファイル共通設定（パーサー）
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
	},
	// routes 配下: style="..." 属性の使用を警告
	// style:prop={value} ディレクティブは動的スタイルに必要なため許可
	// デザインシステム層（$lib/ui, $lib/features）は動的スタイルが必要なため除外
	{
		files: ['src/routes/**/*.svelte'],
		plugins: {
			local: {
				rules: {
					'no-style-attribute': noStyleAttribute,
				},
			},
		},
		rules: {
			'local/no-style-attribute': 'error',
		},
	},
	...storybook.configs['flat/recommended'],
];
