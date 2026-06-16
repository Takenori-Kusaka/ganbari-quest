// Issue #2959 AC1: base branch 解決 SSOT (scripts/lib/resolve-base-branch.mjs) の
// 決定的解決順序 6 段の境界を網羅する unit test。
// develop 二層ブランチ戦略 (docs/sessions/branch-strategy.md §3/§5) のクライアント側 SSOT。
import { describe, expect, it } from 'vitest';
import {
	isAllowedBaseBranch,
	refspecCoversDevelop,
	resolveBaseBranch,
} from '../../../scripts/lib/resolve-base-branch.mjs';

const base = {
	envBase: null as string | null,
	prBase: null as string | null,
	currentBranch: 'feat/123-foo',
	hasDevelop: true,
	containsDevelopOnlyCommits: false,
};

describe('resolveBaseBranch (#2959)', () => {
	it('1. env GANBARI_PR_BASE が最優先 (hotfix escape hatch)', () => {
		expect(resolveBaseBranch({ ...base, envBase: 'main', containsDevelopOnlyCommits: true })).toBe(
			'main',
		);
		expect(resolveBaseBranch({ ...base, envBase: 'develop' })).toBe('develop');
	});

	it('1b. env の origin/ prefix は正規化される', () => {
		expect(resolveBaseBranch({ ...base, envBase: 'origin/main' })).toBe('main');
	});

	it('2. open PR の baseRefName が env の次に優先 (最も権威ある情報)', () => {
		expect(resolveBaseBranch({ ...base, prBase: 'develop' })).toBe('develop');
		// hotfix PR (fix/* → main) は PR base が main を返す
		expect(
			resolveBaseBranch({
				...base,
				currentBranch: 'fix/999-hotfix',
				prBase: 'main',
				containsDevelopOnlyCommits: true,
			}),
		).toBe('main');
	});

	it('3. origin/develop 不在なら main (cutover 前 repo / clone 直後互換)', () => {
		expect(resolveBaseBranch({ ...base, hasDevelop: false })).toBe('main');
	});

	it('4. develop 自身は main へ向かう (統合 PR レーン)', () => {
		expect(
			resolveBaseBranch({ ...base, currentBranch: 'develop', containsDevelopOnlyCommits: true }),
		).toBe('main');
	});

	it('4b. release/* は main へ向かう (release ブランチ方式、develop 固有 commit を含んでも main)', () => {
		// release/* は develop から cut するため develop 固有 commit を含むが、rule 5 より前で main に解決する
		expect(
			resolveBaseBranch({
				...base,
				currentBranch: 'release/2026-06-16',
				containsDevelopOnlyCommits: true,
			}),
		).toBe('main');
	});

	it('5. develop 固有 commit を含む branch は develop (feature lane)', () => {
		expect(resolveBaseBranch({ ...base, containsDevelopOnlyCommits: true })).toBe('develop');
		expect(
			resolveBaseBranch({
				...base,
				currentBranch: 'fix/123-normal-fix',
				containsDevelopOnlyCommits: true,
			}),
		).toBe('develop');
	});

	it('6. develop 固有 commit を含まない branch は main (main 基点 hotfix / develop == main 等価)', () => {
		expect(resolveBaseBranch({ ...base, containsDevelopOnlyCommits: false })).toBe('main');
		expect(
			resolveBaseBranch({
				...base,
				currentBranch: 'fix/999-hotfix',
				containsDevelopOnlyCommits: false,
			}),
		).toBe('main');
	});
});

// Issue #2975 AC1: single-branch refspec self-heal の純粋判定境界。
// main 限定 refspec (clone --single-branch 由来) を heal 対象として正しく検出し、
// 全 branch wildcard / develop 明示行を誤 heal しないことを保証する。
describe('refspecCoversDevelop (#2975)', () => {
	it('main 限定 refspec (single-branch clone 由来) は develop を cover しない → heal 対象', () => {
		expect(refspecCoversDevelop(['+refs/heads/main:refs/remotes/origin/main'])).toBe(false);
	});

	it('全 branch wildcard refspec は develop を cover する → heal 不要', () => {
		expect(refspecCoversDevelop(['+refs/heads/*:refs/remotes/origin/*'])).toBe(true);
	});

	it('develop 明示行 (応急処置済 repo) は cover する → heal 不要 (冪等)', () => {
		expect(
			refspecCoversDevelop([
				'+refs/heads/main:refs/remotes/origin/main',
				'+refs/heads/develop:refs/remotes/origin/develop',
			]),
		).toBe(true);
	});

	it('+ prefix なし refspec 行も判定できる', () => {
		expect(refspecCoversDevelop(['refs/heads/develop:refs/remotes/origin/develop'])).toBe(true);
		expect(refspecCoversDevelop(['refs/heads/main:refs/remotes/origin/main'])).toBe(false);
	});

	it('空配列 (refspec 未設定) は cover しない', () => {
		expect(refspecCoversDevelop([])).toBe(false);
	});
});

// Issue #2982: shell:true コマンド文字列へ展開する前の base branch whitelist 検証。
// develop 二層戦略の正当な lane (main / develop) のみ許可し、injection 面を構造的に閉じる
// (脅威モデルは local tool のため理論枠、ADR-0010 整合)。
describe('isAllowedBaseBranch (#2982)', () => {
	it('正当な 2 lane (main / develop) のみ許可する', () => {
		expect(isAllowedBaseBranch('main')).toBe(true);
		expect(isAllowedBaseBranch('develop')).toBe(true);
	});

	it('origin/ prefix 付き・feature branch・空文字は拒否する', () => {
		expect(isAllowedBaseBranch('origin/main')).toBe(false);
		expect(isAllowedBaseBranch('feature/123-foo')).toBe(false);
		expect(isAllowedBaseBranch('')).toBe(false);
	});

	it('shell metacharacter を含む文字列は拒否する (injection 面の閉鎖)', () => {
		expect(isAllowedBaseBranch('main; rm -rf /')).toBe(false);
		expect(isAllowedBaseBranch('main && echo pwned')).toBe(false);
		expect(isAllowedBaseBranch('$(whoami)')).toBe(false);
		expect(isAllowedBaseBranch('main\ndevelop')).toBe(false);
	});

	it('部分一致 (mainline / developer) は拒否する (anchored regex)', () => {
		expect(isAllowedBaseBranch('mainline')).toBe(false);
		expect(isAllowedBaseBranch('developer')).toBe(false);
	});
});
