// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format

import tsParser from '@typescript-eslint/parser';
import playwright from 'eslint-plugin-playwright';
import sonarjs from 'eslint-plugin-sonarjs';
import storybook from 'eslint-plugin-storybook';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import maxStyleLines from './eslint-plugin-local/max-style-lines.js';
import maxSvelteLines from './eslint-plugin-local/max-svelte-lines.js';
import noHardcodedJpText from './eslint-plugin-local/no-hardcoded-jp-text.js';
import noRawButton from './eslint-plugin-local/no-raw-button.js';
import noStyleAttribute from './eslint-plugin-local/no-style-attribute.js';
import noTailwindArbitraryHex from './eslint-plugin-local/no-tailwind-arbitrary-hex.js';

// ESLint 設定
//
// - Svelte ファイル: UI 品質ルール（style 属性禁止、Tailwind hex 禁止等）
// - src/**/*.ts: SonarJS ルール（文字列重複・認知複雑度・関数重複等）#977
// - JS/TS の基本 lint は Biome が担当
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
					'no-hardcoded-jp-text': noHardcodedJpText,
					'max-style-lines': maxStyleLines,
					'max-svelte-lines': maxSvelteLines,
				},
			},
		},
		rules: {
			'local/no-style-attribute': 'error',
			'local/no-tailwind-arbitrary-hex': 'error',
			'local/no-raw-button': 'error',
			'local/no-hardcoded-jp-text': 'error',
			'local/max-style-lines': ['error', { max: 50 }],
			'local/max-svelte-lines': ['warn', { max: 500 }],
		},
	},
	// src/lib/ 配下: no-hardcoded-jp-text を適用 (#1465 Phase A)
	// stories 含む全 svelte が対象（SSOT 対象外セクション削除済み）
	{
		files: ['src/lib/**/*.svelte'],
		plugins: {
			local: {
				rules: {
					'no-hardcoded-jp-text': noHardcodedJpText,
				},
			},
		},
		rules: {
			'local/no-hardcoded-jp-text': 'error',
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
	// SonarJS: src/**/*.ts に対して文字列重複・認知複雑度等を検出 (#977)
	// Svelte ファイル・テストファイルは対象外（既存 Svelte lint との干渉回避、テストの繰り返しは許容）
	{
		files: ['src/**/*.ts'],
		ignores: ['src/**/*.svelte', 'tests/**/*.ts'],
		plugins: {
			sonarjs,
		},
		languageOptions: {
			parser: tsParser,
		},
		rules: {
			'sonarjs/no-duplicate-string': ['warn', { threshold: 3 }],
			'sonarjs/cognitive-complexity': ['warn', 15],
			'sonarjs/no-identical-functions': 'warn',
			'sonarjs/no-collapsible-if': 'warn',
			'sonarjs/no-redundant-boolean': 'warn',
			'sonarjs/prefer-single-boolean-return': 'warn',
			// 誤検知が多いため off
			'sonarjs/no-nested-template-literals': 'off',
		},
	},
	...storybook.configs['flat/recommended'],
	// Playwright: tests/**/*.ts で非推奨 API の新規流入を error で自動拒否 (#1259 Phase 3)
	// - no-wait-for-timeout: 固定待機禁止 (tests/CLAUDE.md 明記済み、Phase 2 で既存箇所排除)
	// - no-networkidle: Playwright 公式 API ref で DISCOURAGED (Phase 1 で既存箇所排除)
	// - expect-expect: assert ゼロ test を CI 拒否 (#2544 / UnifiedImportHub 事故)。
	//   goal-flows.ts の helper (completeImportFlow 等、assertion 内包) を assertFunctionNames に
	//   登録し、helper 呼び出しも assertion とみなす。これにより「click だけして expect ゼロ」を床上げ。
	//   限界: expect が 1 個でもあれば PASS するため、render-only (toBeVisible だけ) は素通りする。
	//   それは tests/CLAUDE.md §interactive flow の規律 + goal-flows helper で補う (#2544 research §E)。
	{
		files: ['tests/**/*.ts'],
		plugins: {
			playwright,
		},
		languageOptions: {
			parser: tsParser,
		},
		rules: {
			'playwright/no-wait-for-timeout': 'error',
			'playwright/no-networkidle': 'error',
			'playwright/expect-expect': [
				'error',
				{
					// goal-flows.ts の helper (assertion 内包) を assert としてカウント。
					// `expect*` / `assert*` / `verify*` の命名規約も登録 (#2544 research §E)。
					assertFunctionNames: [
						'expect',
						'completeImportFlow',
						'expectListGrew',
						'expectDialogClosed',
						'expectDialogCancellable',
						'expectImportSucceeds',
					],
					assertFunctionPatterns: ['^expect.*', '^assert.*', '^verify.*'],
				},
			],
		},
	},
	// #2544: expect-expect gate を error 化した時点で「assert ゼロ test」を持つ既存 spec を
	// baseline として warn に降格 (一括変換は Issue B / #2459 P2-P5 送り、新規 spec のみ error 強制)。
	// 内訳: ① helper 内で到達検証する spec (loginAs / loginAndSave、本来 assert 相当だが名前が pattern 外)、
	//       ② screenshot 撮影専用 spec (assert なしが性質上合理的)。
	// Issue B で ① は helper を assertFunctionNames に追加 / ② は撮影完了 assert を足して warn を解消する。
	{
		files: [
			'tests/e2e/auth.setup.ts',
			'tests/e2e/cognito-auth.spec.ts',
			'tests/e2e/downgrade-visual.spec.ts',
			'tests/e2e/screenshots-pmf-survey.spec.ts',
			'tests/e2e/tutorial-quickmode-screenshots.spec.ts',
			'tests/e2e/upgrade-flow.spec.ts',
		],
		plugins: {
			playwright,
		},
		rules: {
			'playwright/expect-expect': 'warn',
		},
	},
];
