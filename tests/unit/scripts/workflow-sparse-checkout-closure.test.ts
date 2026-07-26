/**
 * tests/unit/scripts/workflow-sparse-checkout-closure.test.ts (#3969)
 *
 * `sparse-checkout` の列挙漏れで必須 gate job が起動できなくなる class の class-lock。
 *
 * ## 背景
 *
 * gate job は repo 全体ではなく `sparse-checkout` で必要ファイルを**個別列挙**して checkout している。
 * #3969 で CLI 直接実行判定を `scripts/lib/is-main.mjs` (SSOT) へ集約した結果、
 * 列挙された script が helper を import するようになり、helper を列挙していない 6 job が
 * 一斉に `ERR_MODULE_NOT_FOUND` で fail した。
 *
 * `check-cli-entry-guard.mjs` が SSOT 利用を強制する以上、**今後追加する gate script には必ず
 * helper への import が生える**。列挙を手で書き続ける限り再発し続ける構造なので、
 * 注意力ではなく gate で閉じる (ADR-0061 same-class-N→guard)。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
	collectTransitiveDeps,
	extractRelativeImports,
	isCoveredBy,
	parseSparseCheckoutBlocks,
} from '../../../scripts/check-workflow-sparse-checkout-closure.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const GATE = path.join(REPO_ROOT, 'scripts', 'check-workflow-sparse-checkout-closure.mjs');

const tempDirs: string[] = [];

afterAll(() => {
	for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function makeTempDir(prefix: string): string {
	const d = mkdtempSync(path.join(tmpdir(), prefix));
	tempDirs.push(d);
	return d;
}

describe('parseSparseCheckoutBlocks() — block scalar の抽出 (#3969)', () => {
	it('列挙されたパスを取り出し、字下げが浅くなった行で終端する', () => {
		const yaml = [
			'      - uses: actions/checkout@v7',
			'        with:',
			'          sparse-checkout: |',
			'            actions/pr-lane',
			'            scripts/pr-lane.mjs',
			'          sparse-checkout-cone-mode: false',
			'',
			'      - name: next step',
		].join('\n');

		const blocks = parseSparseCheckoutBlocks(yaml);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.line).toBe(3);
		expect(blocks[0]?.entries).toEqual(['actions/pr-lane', 'scripts/pr-lane.mjs']);
	});

	it('1 ファイル内の複数ブロックをすべて拾う', () => {
		const yaml = [
			'          sparse-checkout: |',
			'            scripts/a.mjs',
			'          sparse-checkout-cone-mode: false',
			'          sparse-checkout: |',
			'            scripts/b.mjs',
			'          sparse-checkout-cone-mode: false',
		].join('\n');

		expect(parseSparseCheckoutBlocks(yaml).map((b) => b.entries)).toEqual([
			['scripts/a.mjs'],
			['scripts/b.mjs'],
		]);
	});

	it('sparse-checkout を持たない workflow では 0 件', () => {
		expect(parseSparseCheckoutBlocks('jobs:\n  build:\n    runs-on: ubuntu-latest\n')).toEqual([]);
	});
});

describe('extractRelativeImports() — 相対 import の抽出 (#3969)', () => {
	it('named / default / side-effect / re-export の 4 形を拾う', () => {
		const src = [
			"import { isMain } from './lib/is-main.mjs';",
			"import helper from '../lib/helper.mjs';",
			"import './side-effect.mjs';",
			"export { x } from './reexport.mjs';",
		].join('\n');

		// 抽出順は from 付き → side-effect の 2 パス構成に依存するため、集合として比較する
		expect([...extractRelativeImports(src)].sort()).toEqual([
			'../lib/helper.mjs',
			'./lib/is-main.mjs',
			'./reexport.mjs',
			'./side-effect.mjs',
		]);
	});

	it('bare specifier (node: / npm) は対象外 — checkout ではなく npm ci の担当', () => {
		const src = ["import { readFileSync } from 'node:fs';", "import yaml from 'yaml';"].join('\n');
		expect(extractRelativeImports(src)).toEqual([]);
	});
});

describe('isCoveredBy() — 列挙による被覆判定 (#3969)', () => {
	it('ファイル完全一致で覆う', () => {
		expect(isCoveredBy('scripts/lib/is-main.mjs', ['scripts/lib/is-main.mjs'])).toBe(true);
	});

	it('ディレクトリ列挙は配下を prefix 一致で覆う', () => {
		expect(isCoveredBy('actions/pr-lane/action.yml', ['actions/pr-lane'])).toBe(true);
	});

	it('ファイル名の前方一致だけでは覆ったと見なさない', () => {
		// `scripts/lib` は `scripts/lib-extra.mjs` を覆わない (境界は `/` でのみ切る)
		expect(isCoveredBy('scripts/lib-extra.mjs', ['scripts/lib'])).toBe(false);
	});
});

describe('collectTransitiveDeps() — 実 repo での推移解決 (#3969)', () => {
	it('check-ss-render-health.mjs から helper 2 本へ到達する', () => {
		const deps = collectTransitiveDeps(REPO_ROOT, ['scripts/check-ss-render-health.mjs']);
		expect(deps).toContain('scripts/lib/is-main.mjs');
		expect(deps).toContain('scripts/lib/ci/screenshot-helpers.mjs');
	});

	it('起点自身は依存として返さない', () => {
		expect(collectTransitiveDeps(REPO_ROOT, ['scripts/lib/is-main.mjs'])).not.toContain(
			'scripts/lib/is-main.mjs',
		);
	});
});

describe('class-lock — helper 列挙を外すと未被覆として検出される (#3969)', () => {
	/**
	 * 実際に 6 job を落とした状態を、実 workflow の列挙から helper 行だけ抜いて再現する。
	 * fixture ではなく repo の実物を起点にしているため、workflow が書き換わっても追随する。
	 */
	it('pr-merge-gate.yml の列挙から scripts/lib/is-main.mjs を抜くと未被覆になる', () => {
		const yamlPath = path.join(REPO_ROOT, '.github', 'workflows', 'pr-merge-gate.yml');
		const source = readFileSync(yamlPath, 'utf8');
		const block = parseSparseCheckoutBlocks(source)[0];
		expect(block, 'pr-merge-gate.yml に sparse-checkout ブロックが無い').toBeDefined();

		const entries = block?.entries ?? [];
		// 現状: helper は列挙されており、gate は起点集合の一部として扱うので未被覆にならない
		expect(entries, '列挙から helper が消えている (BLOCK 1 の退行)').toContain(
			'scripts/lib/is-main.mjs',
		);

		// 事故時の状態を再現 — helper 行だけを列挙から抜く
		const mutated = entries.filter((e) => e !== 'scripts/lib/is-main.mjs');
		const starts = mutated.filter((e) => e.endsWith('.mjs'));
		const deps = collectTransitiveDeps(REPO_ROOT, starts);

		expect(deps, 'gate script が helper を import していない (前提が崩れた)').toContain(
			'scripts/lib/is-main.mjs',
		);
		expect(
			isCoveredBy('scripts/lib/is-main.mjs', mutated),
			'helper を抜いても被覆と判定された = gate が事故を見逃す',
		).toBe(false);
	});
});

describe('無言 PASS 条件の可視化 — 起点 0 本を OK と呼ばない (#3969)', () => {
	/**
	 * 本 gate 自身が「壊れると無言で PASS する」形にならないことの class-lock。
	 * 列挙された script が disk 上に無ければ起点が空になり違反 0 件 = exit 0 になるため、
	 * その場合は OK ではなく SKIP と表示して「未検証」であることを出力に残す。
	 */
	function runGateIn(cwd: string): { status: number | null; out: string } {
		const res = spawnSync(process.execPath, [GATE], { cwd, encoding: 'utf8' });
		return { status: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
	}

	it('列挙 script が存在しない環境では OK ではなく SKIP (未検証) と表示する', () => {
		const dir = makeTempDir('gq-sparse-noop-');
		mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
		writeFileSync(
			path.join(dir, '.github', 'workflows', 'gate.yml'),
			[
				'          sparse-checkout: |',
				'            scripts/absent-gate.mjs',
				'          sparse-checkout-cone-mode: false',
				'',
			].join('\n'),
			'utf8',
		);

		const { status, out } = runGateIn(dir);
		expect(status, out).toBe(0);
		expect(out).toContain('SKIP');
		expect(out).toContain('未検証');
		expect(out).not.toContain('OK:');
	});

	it('列挙 script が存在すれば OK と表示し、漏れがあれば exit 1 になる', () => {
		const dir = makeTempDir('gq-sparse-live-');
		mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
		mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
		writeFileSync(path.join(dir, 'scripts', 'lib', 'helper.mjs'), 'export const x = 1;\n', 'utf8');
		writeFileSync(
			path.join(dir, 'scripts', 'gate.mjs'),
			"import { x } from './lib/helper.mjs';\nconsole.log(x);\n",
			'utf8',
		);
		const yamlPath = path.join(dir, '.github', 'workflows', 'gate.yml');
		const block = (entries: string[]): string =>
			['          sparse-checkout: |', ...entries.map((e) => `            ${e}`), ''].join('\n');

		// 列挙漏れあり → exit 1
		writeFileSync(yamlPath, block(['scripts/gate.mjs']), 'utf8');
		const missing = runGateIn(dir);
		expect(missing.status, missing.out).toBe(1);
		expect(missing.out).toContain('scripts/lib/helper.mjs');

		// helper を列挙 → exit 0 かつ OK 表示 (SKIP ではない)
		writeFileSync(yamlPath, block(['scripts/gate.mjs', 'scripts/lib/helper.mjs']), 'utf8');
		const ok = runGateIn(dir);
		expect(ok.status, ok.out).toBe(0);
		expect(ok.out).toContain('OK:');
		expect(ok.out).not.toContain('SKIP');
	});
});

describe('現在の tree — gate 本体を repo 全体に対して実行 (#3969)', () => {
	it('sparse-checkout の import 漏れは 0 件', () => {
		const res = spawnSync(
			process.execPath,
			['scripts/check-workflow-sparse-checkout-closure.mjs'],
			{ cwd: REPO_ROOT, encoding: 'utf8' },
		);
		expect(res.status, `${res.stdout ?? ''}${res.stderr ?? ''}`).toBe(0);
		// no-op (main() 未実行) だと exit 0 かつ無出力になるため、出力の存在も見る
		expect(`${res.stdout ?? ''}${res.stderr ?? ''}`.trim()).not.toBe('');
		// 「検証した」と読める文言を出していること (SKIP と OK を取り違えない)
		expect(res.stdout).toContain('OK:');
	}, 60_000);
});
