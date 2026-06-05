// Issue #2959 AC1: base branch 解決 SSOT (scripts/lib/resolve-base-branch.mjs) の
// 決定的解決順序 6 段の境界を網羅する unit test。
// develop 二層ブランチ戦略 (docs/sessions/branch-strategy.md §3/§5) のクライアント側 SSOT。
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- .mjs module (JSDoc typed、tests/unit/audit/* と同パターン)
import { resolveBaseBranch } from '../../../scripts/lib/resolve-base-branch.mjs';

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
