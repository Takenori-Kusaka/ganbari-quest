// #3877 AC3: type-aware lint (no-floating-promises / no-misused-promises) の回帰保証。
//
// tsc には await 漏れ / 未処理 Promise rejection を捕捉する等価フラグが無い。この bug class を
// eslint.config.js の type-aware ブロック (parserOptions.projectService で型情報をロード) で
// 機械捕捉する。本テストは fitness function として以下を保証する:
//   1. floating promise を書くと no-floating-promises が error を出す (await 漏れ回帰の実証)
//   2. void 期待箇所へ async 関数を渡すと no-misused-promises が error を出す
//   3. await 済みの正常コードは違反 0 (false-positive で開発を止めない)
//   4. リポジトリの eslint.config.js が両ルールを 'error' で実際に有効化している
//
// 1-3 は一時ディレクトリに fixture を生成し ESLint Node API で型情報付き lint を実行して検証する
// (projectService は実ファイル + tsconfig を要求するため on-disk fixture を使う)。4 は「ルールが
// 動く」ことと「リポジトリで有効化されている」ことを紐付け、config から rule が外れる回帰を捕捉する。

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @typescript-eslint/eslint-plugin の型 (configs に旧 Legacy Config を含む) は ESLint flat config の
// Plugin 型と厳密一致しない既知の型定義摩擦。実行時は問題なく動くため flat config Plugin 型へ
// 明示 cast する (ADR-0006 の assertion 弱体化ではなく tooling 型定義差の吸収)。
const typeAwarePlugin = tsPlugin as unknown as ESLint.Plugin;

const FLOATING_RULE = '@typescript-eslint/no-floating-promises';
const MISUSED_RULE = '@typescript-eslint/no-misused-promises';

let root: string;
let eslint: ESLint;

beforeAll(() => {
	root = mkdtempSync(path.join(tmpdir(), 'gq-type-aware-lint-'));

	writeFileSync(
		path.join(root, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				skipLibCheck: true,
				moduleResolution: 'bundler',
				module: 'esnext',
				target: 'esnext',
			},
			include: ['*.ts'],
		}),
	);

	// await 漏れ (floating promise)
	writeFileSync(
		path.join(root, 'floating.ts'),
		'async function doWork(): Promise<void> {}\n' +
			'export function trigger(): void {\n' +
			'\tdoWork();\n' +
			'}\n',
	);

	// 正常 (await 済み) — 違反 0 の control
	writeFileSync(
		path.join(root, 'awaited.ts'),
		'async function doWork(): Promise<void> {}\n' +
			'export async function trigger(): Promise<void> {\n' +
			'\tawait doWork();\n' +
			'}\n',
	);

	// void 期待箇所への async 渡し (misused promise)
	writeFileSync(
		path.join(root, 'misused.ts'),
		'function onClick(cb: () => void): void {\n' +
			'\tcb();\n' +
			'}\n' +
			'async function handler(): Promise<void> {}\n' +
			'export function wire(): void {\n' +
			'\tonClick(handler);\n' +
			'}\n',
	);

	// eslint.config.js の #3877 type-aware ブロックと同じルール構成を再現し、
	// fixture に対して型情報付き lint を実行する。
	eslint = new ESLint({
		cwd: root,
		overrideConfigFile: true,
		overrideConfig: [
			{
				files: ['**/*.ts'],
				plugins: { '@typescript-eslint': typeAwarePlugin },
				languageOptions: {
					parser: tsParser,
					parserOptions: { projectService: true, tsconfigRootDir: root },
				},
				rules: {
					[FLOATING_RULE]: 'error',
					[MISUSED_RULE]: 'error',
				},
			},
		],
	});
});

afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

async function lintRuleIds(file: string): Promise<string[]> {
	const results = await eslint.lintFiles([path.join(root, file)]);
	return results.flatMap((r) => r.messages).map((m) => m.ruleId ?? '');
}

describe('#3877 type-aware lint (no-floating-promises / no-misused-promises)', () => {
	it('await 漏れ (floating promise) を no-floating-promises が error で検出する', async () => {
		const ruleIds = await lintRuleIds('floating.ts');
		expect(ruleIds).toContain(FLOATING_RULE);
	});

	it('void 期待箇所への async 渡しを no-misused-promises が error で検出する', async () => {
		const ruleIds = await lintRuleIds('misused.ts');
		expect(ruleIds).toContain(MISUSED_RULE);
	});

	it('await 済みの正常コードは違反 0 (false-positive を出さない)', async () => {
		const ruleIds = await lintRuleIds('awaited.ts');
		expect(ruleIds).toEqual([]);
	});

	it('リポジトリの eslint.typed.config.js (CI 限定 config) が両ルールを error で有効化している', () => {
		// type-aware ルールは default eslint.config.js ではなく分離 config に隔離される
		// (ローカル / pre-push を高速維持するため、#3877 性能制約)。
		const config = readFileSync(path.resolve(process.cwd(), 'eslint.typed.config.js'), 'utf8');
		expect(config).toMatch(/'@typescript-eslint\/no-floating-promises':\s*'error'/);
		expect(config).toMatch(/'@typescript-eslint\/no-misused-promises':\s*'error'/);
	});

	it('default eslint.config.js には type-aware ルール有効化 / projectService 設定を載せない (ローカル高速維持)', () => {
		// 説明コメントに用語が出るのは可。実際の「ルール error 有効化」と「projectService: true 設定」が
		// default config に無いことを検証する (これらがあるとローカル eslint 全体が型ロードで遅くなる)。
		const config = readFileSync(path.resolve(process.cwd(), 'eslint.config.js'), 'utf8');
		expect(config).not.toMatch(/no-floating-promises':\s*'error'/);
		expect(config).not.toMatch(/no-misused-promises':\s*'error'/);
		expect(config).not.toMatch(/projectService:\s*true/);
	});
});
