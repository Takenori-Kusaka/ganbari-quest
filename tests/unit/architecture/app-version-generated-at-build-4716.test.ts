// tests/unit/architecture/app-version-generated-at-build-4716.test.ts (#4716 item 14 / PO 回答 2026-09-03)
//
// 設定 > サポートに出る「バージョン: v1.20260411.0」が 4 ヶ月前の値で固定されていた (#4716)。
// 原因は `src/lib/version.ts` が生成物としてコミットされている一方、生成コマンドが build から
// 呼ばれていなかったこと。#4716 は `prebuild` で毎ビルド再生成する配線にしたが、今度は
// `npm run build` のたびに版数の diff が無関係な PR に混ざった (#4825 で実際に混入)。
//
// PO 回答 (2026-09-03): 版数は生成物として扱い、ビルドごとの diff が PR に出ないようにする。
// 対処は生成物そのものを無くすこと — vite.config.ts の `define` がビルドのたびに値を計算し、
// `src/lib/version.ts` はそれを読むだけの (中身が変わらない) source になる。
// 本 test は「その配線が外れたら落ちる」「生成物の書き手が復活したら落ちる」ことを見る。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, APP_VERSION_DATE } from '../../../src/lib/version';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

describe('#4716 アプリバージョンはビルドのたびに計算され、生成物はコミットされない', () => {
	it('APP_VERSION は define 経由で v{major}.{YYYYMMDD}.{patch} の値を持つ', () => {
		expect(APP_VERSION).toMatch(/^v\d+\.\d{8}\.\d+$/);
		expect(new Date(APP_VERSION_DATE).toISOString()).toBe(APP_VERSION_DATE);
	});

	it('vite.config.ts が __APP_VERSION__ / __APP_VERSION_DATE__ を define する', () => {
		const vite = read('vite.config.ts');
		expect(vite).toMatch(
			/define:\s*\{[\s\S]*__APP_VERSION__:[\s\S]*__APP_VERSION_DATE__:[\s\S]*\}/,
		);
	});

	it('src/lib/version.ts は define の値を読むだけで、版数 literal を持たない (= build で書き換わらない)', () => {
		const src = read('src/lib/version.ts');
		expect(src).toContain('export const APP_VERSION: string = __APP_VERSION__;');
		expect(src).toContain('export const APP_VERSION_DATE: string = __APP_VERSION_DATE__;');
		expect(src).not.toMatch(/v\d+\.\d{8}\.\d+/);
	});

	it('生成物の書き手 (prebuild / version:generate) が復活していない', () => {
		expect(pkg.scripts.prebuild).toBeUndefined();
		expect(pkg.scripts['version:generate']).toBeUndefined();
		expect(pkg.scripts.build).not.toContain('version');
	});

	it('Dockerfile / deploy workflow も生成コマンドを呼ばない (build だけで版数が入る)', () => {
		for (const rel of [
			'Dockerfile',
			'Dockerfile.lambda',
			'.github/workflows/deploy.yml',
			'.github/workflows/deploy-aws-staging.yml',
		]) {
			expect(read(rel), rel).not.toContain('version:generate');
		}
	});
});
