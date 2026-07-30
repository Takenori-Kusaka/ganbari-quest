/**
 * tests/unit/scripts/check-orphan-repos-population.test.ts (#4030 A-1)
 *
 * ## 何が壊れていたか
 *
 * `check-orphan-repos.mjs` の検査対象 layer は literal 固定だった:
 *
 * ```js
 * const REPO_LAYER_DIRS = ['sqlite', 'demo', 'dynamodb'];
 * ```
 *
 * `dynamodb` は #3438 で撤去済で dir すら存在しない。一方、現行アーキの中心である
 * `dsql/` (repo 34 本) と `pglite/` は**一度も検査対象に入っていなかった**。
 * 「layer の追加忘れ / 削除忘れを可視化する」と自称する guard が、**layer の増減自体に
 * 追随できていなかった**。
 *
 * ## 本 test が固定すること
 *
 * 母数が実 FS から導出されること、および除外が理由付きで明示されること。
 * 「dsql を literal に足す」だけの修正では [O2] が通らない (同じ腐り方を再現するため)。
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。既定 5s のままだと unit lane の
// 並列実行の負荷で落ち、「本物の回帰か負荷か」の切り分けが毎回発生するため file 単位で明示する。
// 区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const scriptUrl = pathToFileURL(resolve(repoRoot, 'scripts/check-orphan-repos.mjs')).href;
const utilsUrl = pathToFileURL(resolve(repoRoot, 'scripts/lib/ci/orphan-utils.mjs')).href;

/** .mjs の named export を子プロセスで評価して JSON で受け取る (svelte-check の型 program に載せない)。 */
function evalInScript<T>(url: string, expr: string): T {
	const code = `const m = await import(${JSON.stringify(url)});
process.stdout.write(JSON.stringify(${expr}));`;
	return JSON.parse(
		execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }),
	) as T;
}

const dbDirs = readdirSync(resolve(repoRoot, 'src/lib/server/db'), { withFileTypes: true })
	.filter((e) => e.isDirectory())
	.map((e) => e.name);

describe('#4030 A-1 repo layer の母数は実 FS 由来である', () => {
	it('[O1] db/ 直下の全 dir は「検査対象」か「理由付き除外」のどちらかに分類される', () => {
		const layers = evalInScript<string[]>(scriptUrl, 'm.resolveRepoLayerDirs()');
		const excluded = Object.keys(evalInScript<object>(scriptUrl, 'm.NON_REPO_LAYER_DIRS'));
		const unclassified = dbDirs.filter((d) => !layers.includes(d) && !excluded.includes(d));
		expect(unclassified).toEqual([]);
	});

	// 現行アーキの中心。ここが母数から漏れていたのが本 Issue の実害。
	it('[O2] 実在する backend layer (dsql / pglite / sqlite / demo) が全て検査対象に入る', () => {
		const layers = evalInScript<string[]>(scriptUrl, 'm.resolveRepoLayerDirs()');
		for (const expected of ['dsql', 'pglite', 'sqlite', 'demo']) {
			expect(layers).toContain(expected);
		}
	});

	it('[O3] 除外 dir は実在し、かつ理由が非空である', () => {
		const excluded = evalInScript<Record<string, string>>(scriptUrl, 'm.NON_REPO_LAYER_DIRS');
		for (const [name, reason] of Object.entries(excluded)) {
			// 消えた dir の除外を残さない (母数が腐る方向)
			expect(dbDirs, `除外 dir "${name}" が実在しない`).toContain(name);
			expect(reason.trim().length, `除外 dir "${name}" の理由が空`).toBeGreaterThan(0);
		}
	});

	// literal 固定に戻す修正を検出する。source 文字列検査なのは、
	// 「FS から導出しているか」は戻り値だけでは区別できないため
	// (literal に dsql / pglite を足しても [O1] [O2] は通ってしまう)。
	it('[O4] layer 一覧を literal 配列で持ち直していない', () => {
		const src = readFileSync(resolve(repoRoot, 'scripts/check-orphan-repos.mjs'), 'utf8');
		expect(src).toMatch(/readdirSync\(dbDir/);
		// 旧実装を引用している doc コメントは対象外 (実コード行だけを見る)
		const codeOnly = src
			.split('\n')
			.filter((l) => {
				const t = l.trimStart();
				return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
			})
			.join('\n');
		expect(codeOnly).not.toMatch(/REPO_LAYER_DIRS\s*=\s*\[/);
	});
});

describe('#4030 baseline に実在しないファイルの entry を残さない', () => {
	it('[O5] staleBaselineEntries が実在しない entry を検出する', () => {
		const stale = evalInScript<string[]>(
			utilsUrl,
			"m.staleBaselineEntries({ allowed: ['src/lib/server/db/dynamodb/client.ts', 'package.json'] })",
		);
		expect(stale).toEqual(['src/lib/server/db/dynamodb/client.ts']);
	});

	it('[O6] path でない entry (識別子 baseline) を誤検出しない', () => {
		const stale = evalInScript<string[]>(
			utilsUrl,
			"m.staleBaselineEntries({ allowed: ['SOME_ENV_NAME', 'someLabelKey'] })",
		);
		expect(stale).toEqual([]);
	});

	it('[O7] 全 orphan baseline に実在しない entry が無い', () => {
		const baselineDir = resolve(repoRoot, 'scripts/orphan-baselines');
		const offenders: string[] = [];
		for (const file of readdirSync(baselineDir).filter((f) => f.endsWith('.json'))) {
			const baseline = JSON.parse(readFileSync(resolve(baselineDir, file), 'utf8'));
			const stale = evalInScript<string[]>(
				utilsUrl,
				`m.staleBaselineEntries(${JSON.stringify({ allowed: baseline.allowed ?? [] })})`,
			);
			for (const s of stale) offenders.push(`${file}: ${s}`);
		}
		expect(offenders).toEqual([]);
	});
});
