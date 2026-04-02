// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook';

import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import maxStyleLines from './eslint-plugin-local/max-style-lines.js';
import maxSvelteLines from './eslint-plugin-local/max-svelte-lines.js';
import noRawButton from './eslint-plugin-local/no-raw-button.js';
import noStyleAttribute from './eslint-plugin-local/no-style-attribute.js';
import noTailwindArbitraryHex from './eslint-plugin-local/no-tailwind-arbitrary-hex.js';

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
	// routes 配下: デザインシステム品質ルール
	// style="..." 属性禁止、Tailwind hex 禁止、raw <button> 禁止、スタイル行数制限、ファイル行数制限
	// デザインシステム層（$lib/ui, $lib/features）は除外（routes のみ適用）
	{
		files: ['src/routes/**/*.svelte'],
		plugins: {
			local: {
				rules: {
					'no-style-attribute': noStyleAttribute,
					'no-tailwind-arbitrary-hex': noTailwindArbitraryHex,
					'no-raw-button': noRawButton,
					'max-style-lines': maxStyleLines,
					'max-svelte-lines': maxSvelteLines,
				},
			},
		},
		rules: {
			'local/no-style-attribute': 'error',
			'local/no-tailwind-arbitrary-hex': 'error',
			'local/no-raw-button': 'error',
			'local/max-style-lines': ['error', { max: 50 }],
			'local/max-svelte-lines': ['warn', { max: 500 }],
		},
	},
	// routes 配下の .ts ファイル用パーサー設定
	// （.svelte は上の共通設定ブロックでパーサーが設定済み）
	{
		files: ['src/routes/**/*.ts'],
		languageOptions: {
			parser: tsParser,
		},
	},
	// Ark UI 直接 import 禁止（routes 配下）
	// $lib/ui/primitives/ のラッパーコンポーネント経由で使用すること
	{
		files: ['src/routes/**/*.svelte', 'src/routes/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '@ark-ui/svelte',
							message:
								'Use $lib/ui/primitives/ wrappers instead of importing @ark-ui/svelte directly.',
						},
					],
					patterns: [
						{
							group: ['@ark-ui/svelte/*'],
							message:
								'Use $lib/ui/primitives/ wrappers instead of importing @ark-ui/svelte directly.',
						},
					],
				},
			],
		},
	},
	...storybook.configs['flat/recommended'],
];
