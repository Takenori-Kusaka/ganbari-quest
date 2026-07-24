// #3877: type-aware lint 専用の分離 config (CI 限定)。
//
// no-floating-promises / no-misused-promises は型情報 (parserOptions.projectService) を要するため
// lint がやや重くなる。これを default の eslint.config.js に載せるとローカル / pre-push / pre-ready の
// eslint 全体が型プログラムをロードして遅くなり、定常 dev ループの足を引っ張る。そのため型情報を要する
// correctness ルールは本 config に隔離し、CI の専用 step (`npm run lint:typed`) でのみ実行する。
//
// 実行: `eslint --config eslint.typed.config.js "src/**/*.ts" "infra/lib/**/*.ts" "infra/bin/**/*.ts"`
//   (--config 指定時 ESLint は default config を探さないため、本 config は自己完結させる)
//
// scope はアプリ src と CDK (infra/lib・infra/bin) の production / server コード:
//  - tests/**/*.ts は Vitest mock 実装 (mockImplementationOnce(async () => ...)) で
//    no-misused-promises が false-positive を出す + CI コスト増のため除外
//    (await 漏れはテスト失敗で顕在化する)。
//  - src/service-worker.ts は WorkerGlobalScope 用に projectService 非解決のため除外。
//  - infra/lambda/** は infra/tsconfig.json の include 外 (別バンドル) のため対象外。
//
// Phase 1 は correctness 系 2 ルールに絞る (ルール全部盛りは CI 時間を膨張させるため)。
// 見送り / 将来 phase 判断は docs/design/typescript-strictness-policy.md §3.3 / §4。

import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
	{
		files: ['src/**/*.ts', 'infra/lib/**/*.ts', 'infra/bin/**/*.ts'],
		ignores: ['**/*.d.ts', 'src/service-worker.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
		plugins: {
			'@typescript-eslint': tsPlugin,
		},
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
		},
	},
];
