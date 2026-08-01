/**
 * tests/unit/scripts/pre-ready-preflight.test.ts (#3857)
 *
 * 隔離 worktree (.claude/worktrees/) 上で品質ゲート (pre-ready) が空振りする構造欠落
 * (#3855 / #3856 の 2 agent が共に遭遇) への恒久対策の回帰ガード。
 *
 * 検証対象:
 *   1. scripts/pre-ready.mjs の preflightWorktreeDeps() — 依存欠落を silent に pass しない
 *      (Fix C、ADR-0006 no-silent-fail 整合)。
 *      pre-ready.mjs は plain .mjs (未 JSDoc 型) のため、.ts test から静的 import すると
 *      svelte-check の型 program に取り込まれ既存の implicit-any を大量に露出する。それを避けつつ
 *      実関数を検証するため、node 子プロセスの dynamic import 経由で呼び出す (isMain guard により
 *      import 時に main() は走らない)。
 *   2. biome.json の `.claude` ignore が repo 相対 anchor (`!.claude`) であり、
 *      unanchored な glob 版に戻っていないこと (Fix B の回帰ガード)。
 *      unanchored だと worktree 絶対パス (`.../.claude/worktrees/...`) を巻き込み
 *      `biome check .` が「Checked 0 files」で false-negative になる (#3857 root cause)。
 *      具体的な禁止 pattern 文字列はテスト本体の assertion を参照。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const preReadyUrl = pathToFileURL(resolve(repoRoot, 'scripts/pre-ready.mjs')).href;

/**
 * pre-ready.mjs を子プロセスで dynamic import し、preflightWorktreeDeps(root) の結果と
 * PREFLIGHT_SENTINELS を JSON で受け取る (静的 import を避け svelte-check の型検査対象に含めない)。
 */
function callPreflight(root: string): {
	result: { ok: boolean; isWorktree: boolean; missing: string[] };
	sentinels: string[];
} {
	const code = `const m = await import(${JSON.stringify(preReadyUrl)});
process.stdout.write(JSON.stringify({ result: m.preflightWorktreeDeps(${JSON.stringify(root)}), sentinels: m.PREFLIGHT_SENTINELS }));`;
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
		encoding: 'utf8',
	});
	return JSON.parse(out);
}

describe('preflightWorktreeDeps (#3857 Fix C)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), 'pre-ready-preflight-'));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it('依存が全欠落なら ok:false + 全 sentinel を missing に列挙する (silent pass しない)', () => {
		const { result, sentinels } = callPreflight(tmp);
		expect(result.ok).toBe(false);
		expect(result.missing).toEqual(sentinels);
	});

	it('全 sentinel が存在すれば ok:true / missing 空', () => {
		const { sentinels } = callPreflight(tmp);
		for (const s of sentinels) {
			mkdirSync(resolve(tmp, s), { recursive: true });
		}
		const { result } = callPreflight(tmp);
		expect(result.ok).toBe(true);
		expect(result.missing).toEqual([]);
	});

	it('sentinel が 1 つでも欠落すれば ok:false (部分 install を install 済とみなさない)', () => {
		const { sentinels } = callPreflight(tmp);
		for (const s of sentinels) {
			mkdirSync(resolve(tmp, s), { recursive: true });
		}
		// svelte-check (Step 2 依存) のみ欠落させる
		// (#4121 で pre-ready を 6 step に絞り、vitest / tsx / aws-cdk-lib は CI 側 job の依存になった)
		rmSync(resolve(tmp, 'node_modules/svelte-check'), { recursive: true, force: true });
		const { result } = callPreflight(tmp);
		expect(result.ok).toBe(false);
		expect(result.missing).toContain('node_modules/svelte-check');
	});

	it('.git がファイル (linked worktree の gitdir ポインタ) なら isWorktree:true', () => {
		writeFileSync(resolve(tmp, '.git'), 'gitdir: /some/main/repo/.git/worktrees/x\n');
		const { result } = callPreflight(tmp);
		expect(result.isWorktree).toBe(true);
	});

	it('.git がディレクトリ (通常 clone) なら isWorktree:false', () => {
		mkdirSync(resolve(tmp, '.git'), { recursive: true });
		const { result } = callPreflight(tmp);
		expect(result.isWorktree).toBe(false);
	});

	it('本リポジトリ root は依存 install 済で ok:true (実環境 sanity)', () => {
		// node_modules 前提の他 test が動いている = install 済のはずなので ok を確認
		expect(callPreflight(repoRoot).result.ok).toBe(true);
	});
});

describe('biome.json .claude ignore anchor (#3857 Fix B 回帰ガード)', () => {
	it('files.includes は anchored `!.claude` を使い、unanchored な glob 版に戻っていない', () => {
		const biomeConfig = JSON.parse(readFileSync(resolve(repoRoot, 'biome.json'), 'utf8'));
		const includes: string[] = biomeConfig.files?.includes ?? [];
		expect(includes).toContain('!.claude');
		// unanchored パターンは worktree 絶対パスを巻き込み「Checked 0 files」を再発させる
		expect(includes).not.toContain('!**/.claude');
	});

	it('biome.json が worktree 配下でも存在する (sanity)', () => {
		expect(existsSync(resolve(repoRoot, 'biome.json'))).toBe(true);
	});
});
