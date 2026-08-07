// Svelte 5 の rune module (`*.svelte.ts`) が eslint の走査対象に入り続けることを保証する
// fitness function。
//
// 背景: `package.json` の `lint` / `lint:svelte` は長らく `'src/**/*.svelte'` だけを渡しており、
// `$state` / `$derived` を持つ `*.svelte.ts` (実質 Svelte コード) が eslint 未走査だった。
// eslint-plugin-svelte の base config は `**/*.svelte.ts` に svelte-eslint-parser を割り当てる
// 設定を最初から持っているため、config ではなく「CLI へ渡す glob」だけが欠けていた。
//
// 本テストは以下を assert する:
//   1. `lint` / `lint:svelte` の両方が `src/**/*.svelte.ts` を CLI 引数に持つ
//   2. その glob が **1 件以上**の実ファイルに解決し、どれも eslint の ignore 対象でない
//      (「対象 0 件のまま緑」という空振りを禁止する — ADR-0061)
//   3. 解決した各ファイルに svelte/* ルールが実際に適用される (parser だけ割り当たって
//      ルールが空、という状態を許さない)
//
// lint script は `--no-error-on-unmatched-pattern` を付けているため、glob が 1 件も拾わなく
// なっても script 自体は成功で返る。検査の生存を別レイヤーで固定する必要があるのはこのため。
//
// 実 lint の実行 (`ESLint#lintFiles`) は本 repo で 100s 超かかるため行わない。ここで固定するのは
// 「走査対象に入っているか」であり、ルール違反の検出自体は `npm run lint` / CI が担う。

import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const RUNE_MODULE_GLOB = 'src/**/*.svelte.ts';
// svelte-eslint-parser が割り当たっていないと有効化されない (= parser 配線の生存を代表する) ルール。
const SVELTE_RULE_PROBE = 'svelte/no-navigation-without-resolve';

function lintScripts(): Record<string, string> {
	const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
		scripts: Record<string, string>;
	};
	return pkg.scripts;
}

function runeModules(): string[] {
	return globSync(RUNE_MODULE_GLOB, { cwd: REPO_ROOT })
		.map((f) => f.replaceAll('\\', '/'))
		.sort();
}

describe('svelte lint glob が rune module (*.svelte.ts) を覆う', () => {
	it('lint / lint:svelte が src/**/*.svelte.ts を CLI 引数に渡している', () => {
		const scripts = lintScripts();
		for (const name of ['lint', 'lint:svelte']) {
			expect(scripts[name], `${name} script が存在する`).toBeTruthy();
			expect(scripts[name], `${name} が ${RUNE_MODULE_GLOB} を走査対象に含む`).toContain(
				RUNE_MODULE_GLOB,
			);
		}
	});

	it('glob が 1 件以上の *.svelte.ts に解決し、ignore されず svelte/* ルールが効いている', async () => {
		const files = runeModules();
		// 0 件だと「lint は緑だが何も見ていない」状態。将来 rune module が全廃されたなら
		// 本テストごと削除する (閾値を 0 に下げて延命しない)。
		expect(files.length, `解決した *.svelte.ts: ${JSON.stringify(files)}`).toBeGreaterThan(0);

		const eslint = new ESLint({ cwd: REPO_ROOT });
		for (const file of files) {
			const absolute = path.join(REPO_ROOT, file);
			expect(
				await eslint.isPathIgnored(absolute),
				`${file} が eslint の ignore 対象になっていない`,
			).toBe(false);

			const config = (await eslint.calculateConfigForFile(absolute)) as {
				rules?: Record<string, unknown>;
			};
			expect(
				Object.keys(config.rules ?? {}),
				`${file} に ${SVELTE_RULE_PROBE} が適用されている`,
			).toContain(SVELTE_RULE_PROBE);
		}
	}, 60_000);
});
