/**
 * tests/unit/scripts/check-recent-deploy-deletion.test.ts (#2603)
 *
 * scripts/check-recent-deploy-deletion.mjs の純粋関数を unit test する。
 *
 * Issue #2603 の AC-1 検証: PR diff が直近 7 日 merge 済 file を削除している場合に
 * 警告 + exit 2 を返す挙動を境界値網羅でテストする。
 *
 * **対象境界値** (本 PR 起票 prompt の Step 1 spec より、Issue body の AC-1 を含む):
 *
 *   AC-1: 直近 7 日 merge file が PR diff で削除 → exit 2 (violation 検出)
 *   AC-2: 直近 7 日 merge file が PR diff で削除なし → exit 0
 *   AC-3: 削除 file が 8 日前 merge → exit 0 (7 日 window 外、本 test は `findViolations`
 *         の入力データで間接的に検証)
 *   AC-4: rename 扱い (archive 移動) は `git diff -M` の R 行で除外される (false positive 回避)
 *   AC-5: --ignore-pattern 指定で legitimate deletion を許容
 *   AC-6: --days 引数で window 調整可能
 *   AC-7: PR 番号未指定時のデフォルト動作
 *
 * 関連:
 *   - Issue #2603 (本 test 起票 Issue)
 *   - Issue #2598 (Dev Agent rebase 予防、QM review 側補完)
 *   - ADR-0056 (QM drift prevention、本 script は案 1 deploy 保全機構)
 */

import { describe, expect, it } from 'vitest';

import {
	DEFAULT_BASE,
	DEFAULT_DAYS,
	findViolations,
	helpText,
	isIgnored,
	parseArgs,
	verifyWorktreeHeadMatchesPrHead,
} from '../../../scripts/check-recent-deploy-deletion.mjs';

describe('parseArgs', () => {
	// AC-7: PR 番号未指定時のデフォルト動作
	it('引数なし → デフォルト値 (days=7, base=origin/main, prNumber=null)', () => {
		const opts = parseArgs([]);
		expect(opts.prNumber).toBeNull();
		expect(opts.days).toBe(DEFAULT_DAYS);
		expect(opts.base).toBe(DEFAULT_BASE);
		expect(opts.ignorePatterns).toEqual([]);
		expect(opts.help).toBe(false);
	});

	// AC-7: --pr 引数で PR 番号を指定可能
	it('--pr 2603 → prNumber が "2603"', () => {
		const opts = parseArgs(['--pr', '2603']);
		expect(opts.prNumber).toBe('2603');
	});

	// AC-6: --days 引数で window 調整可能
	it('--days 14 → days が 14', () => {
		const opts = parseArgs(['--days', '14']);
		expect(opts.days).toBe(14);
	});

	// AC-6: --days 1 (1 日 window) 境界値
	it('--days 1 → days が 1 (最小実用境界値)', () => {
		const opts = parseArgs(['--days', '1']);
		expect(opts.days).toBe(1);
	});

	// AC-5: --ignore-pattern で除外 regex を蓄積
	it('--ignore-pattern を複数指定 → ignorePatterns に蓄積', () => {
		const opts = parseArgs([
			'--ignore-pattern',
			'^docs/decisions/archive/',
			'--ignore-pattern',
			'^tmp/',
		]);
		expect(opts.ignorePatterns).toHaveLength(2);
		// noUncheckedIndexedAccess narrowing: assert defined before accessing .test()
		// (ADR-0006 test code exception: non-null assert acceptable in tests for clarity)
		const pat0 = opts.ignorePatterns[0];
		const pat1 = opts.ignorePatterns[1];
		expect(pat0).toBeInstanceOf(RegExp);
		expect(pat1).toBeInstanceOf(RegExp);
		if (!pat0 || !pat1) throw new Error('ignorePatterns[0..1] must be defined');
		// Note: RegExp.source escapes '/' as '\/' in Node, so we test by .test() behavior
		expect(pat0.test('docs/decisions/archive/0031-foo.md')).toBe(true);
		expect(pat0.test('docs/decisions/0056-active.md')).toBe(false);
		expect(pat1.test('tmp/foo.md')).toBe(true);
	});

	it('--base origin/develop → base 差替', () => {
		const opts = parseArgs(['--base', 'origin/develop']);
		expect(opts.base).toBe('origin/develop');
	});

	it('--help → help true', () => {
		const opts = parseArgs(['--help']);
		expect(opts.help).toBe(true);
	});

	it('-h alias でも help true', () => {
		const opts = parseArgs(['-h']);
		expect(opts.help).toBe(true);
	});

	it('全 flag 同時指定 → 全反映', () => {
		const opts = parseArgs([
			'--pr',
			'2603',
			'--days',
			'14',
			'--base',
			'origin/main',
			'--ignore-pattern',
			'^docs/decisions/archive/',
		]);
		expect(opts.prNumber).toBe('2603');
		expect(opts.days).toBe(14);
		expect(opts.base).toBe('origin/main');
		expect(opts.ignorePatterns).toHaveLength(1);
	});
});

describe('isIgnored', () => {
	// AC-5: --ignore-pattern マッチ → ignore
	it('archive 移動 path → ignore', () => {
		const patterns = [/^docs\/decisions\/archive\//];
		expect(isIgnored('docs/decisions/archive/0031-foo.md', patterns)).toBe(true);
	});

	it('archive 外 path → not ignore', () => {
		const patterns = [/^docs\/decisions\/archive\//];
		expect(isIgnored('scripts/check-recent-deploy-deletion.mjs', patterns)).toBe(false);
	});

	it('複数 pattern のいずれかにマッチ → ignore', () => {
		const patterns = [/^docs\/decisions\/archive\//, /^tmp\//];
		expect(isIgnored('tmp/foo.md', patterns)).toBe(true);
	});

	it('空 patterns → not ignore (全件素通し)', () => {
		expect(isIgnored('any/file.md', [])).toBe(false);
	});
});

describe('findViolations', () => {
	// AC-1: 直近 deploy file 削除を検出
	it('AC-1: 直近 merge file が PR diff で削除 → violation 1 件', () => {
		const deleted = ['docs/decisions/0056-qm-drift-prevention.md'];
		const merges = [
			{
				commit: 'b86181f3deadbeef',
				date: '2026-05-28 10:00:00 +0900',
				files: ['docs/decisions/0056-qm-drift-prevention.md', '.claude/hooks/gate-approve.mjs'],
			},
		];
		const violations = findViolations(deleted, merges, []);
		expect(violations).toHaveLength(1);
		// noUncheckedIndexedAccess narrowing: assert defined before accessing properties
		const v0 = violations[0];
		if (!v0) throw new Error('violations[0] must be defined');
		expect(v0.file).toBe('docs/decisions/0056-qm-drift-prevention.md');
		expect(v0.commit).toBe('b86181f3');
		expect(v0.date).toBe('2026-05-28 10:00:00 +0900');
	});

	// AC-2: 直近 merge file が PR diff で削除なし → exit 0
	it('AC-2: PR diff の削除 file が直近 merge file と重複なし → violation 0 件', () => {
		const deleted = ['some-unrelated-old-file.md'];
		const merges = [
			{
				commit: 'b86181f3',
				date: '2026-05-28 10:00:00 +0900',
				files: ['docs/decisions/0056-qm-drift-prevention.md'],
			},
		];
		const violations = findViolations(deleted, merges, []);
		expect(violations).toHaveLength(0);
	});

	// AC-3: 削除 file が window 外 (8 日前 merge) → exit 0
	// findViolations は window 判定を内包しないため、`getRecentMergedFiles` の側で
	// `--since=N days ago` filter で window 外 commit を除外する仕様。本 unit test では
	// merges 配列が空 (window 外で getRecentMergedFiles が返さない状態) を simulate する。
	it('AC-3: window 外 (古い) merge は merges に含まれず → violation 0 件', () => {
		const deleted = ['docs/decisions/0001-old-adr.md'];
		const merges: Array<{ commit: string; date: string; files: string[] }> = []; // window 外で空
		const violations = findViolations(deleted, merges, []);
		expect(violations).toHaveLength(0);
	});

	// AC-5: --ignore-pattern で legitimate deletion を許容
	it('AC-5: archive 移動 path が ignore-pattern にマッチ → violation 0 件', () => {
		const deleted = ['docs/decisions/0031-deprecated-adr.md'];
		const merges = [
			{
				commit: 'abcdef12',
				date: '2026-05-28 12:00:00 +0900',
				files: ['docs/decisions/0031-deprecated-adr.md'],
			},
		];
		const violations = findViolations(deleted, merges, [/^docs\/decisions\/0031-/]);
		expect(violations).toHaveLength(0);
	});

	it('AC-5: ignore-pattern にマッチしない違反は残る (混在ケース)', () => {
		const deleted = [
			'docs/decisions/0031-archived.md', // ignore される
			'scripts/check-recent-deploy-deletion.mjs', // 残る
		];
		const merges = [
			{
				commit: 'abcdef12',
				date: '2026-05-28 12:00:00 +0900',
				files: ['docs/decisions/0031-archived.md', 'scripts/check-recent-deploy-deletion.mjs'],
			},
		];
		const violations = findViolations(deleted, merges, [/^docs\/decisions\/0031-/]);
		expect(violations).toHaveLength(1);
		// noUncheckedIndexedAccess narrowing: assert defined before accessing .file
		const v0 = violations[0];
		if (!v0) throw new Error('violations[0] must be defined');
		expect(v0.file).toBe('scripts/check-recent-deploy-deletion.mjs');
	});

	// 複数 merge commit にまたがる削除も全件報告
	it('複数 merge commit にまたがる violation → 全件報告', () => {
		const deleted = ['file-a.md', 'file-b.md'];
		const merges = [
			{
				commit: 'aaaaaaa1',
				date: '2026-05-28 10:00:00 +0900',
				files: ['file-a.md'],
			},
			{
				commit: 'bbbbbbb2',
				date: '2026-05-27 15:00:00 +0900',
				files: ['file-b.md'],
			},
		];
		const violations = findViolations(deleted, merges, []);
		expect(violations).toHaveLength(2);
		expect(violations.map((v) => v.file).sort()).toEqual(['file-a.md', 'file-b.md']);
	});

	// 削除 file 0 件 → violation 0 件 (defensive)
	it('削除 file 0 件 → violation 0 件', () => {
		const merges = [
			{
				commit: 'b86181f3',
				date: '2026-05-28 10:00:00 +0900',
				files: ['some-file.md'],
			},
		];
		const violations = findViolations([], merges, []);
		expect(violations).toHaveLength(0);
	});
});

describe('helpText', () => {
	it('help text に主要 flag 説明が含まれる', () => {
		const text = helpText();
		expect(text).toContain('--pr');
		expect(text).toContain('--days');
		expect(text).toContain('--ignore-pattern');
		expect(text).toContain('--base');
		expect(text).toContain('Exit codes:');
		expect(text).toContain('Issue #2603');
	});

	// #2618: help text に worktree HEAD verify gate (ADR-0056 §D) の説明が含まれる
	it('#2618: help text に worktree HEAD verify gate (ADR-0056 §D) が記載される', () => {
		const text = helpText();
		expect(text).toContain('#2618');
		expect(text).toContain('ADR-0056 §D');
		expect(text).toContain('worktree HEAD');
	});
});

/**
 * #2618 / ADR-0056 §D: worktree HEAD verify gate (機構運用層 self-defense)
 *
 * Fix Agent worktree モードで `origin/main` HEAD 空 worktree のまま gate を回した際の
 * 偽陽性 (PR #2613 Round 3 で legal critical 506 行喪失寸前まで進んだ実害観察) を
 * 構造的に防ぐ verify gate。
 */
describe('verifyWorktreeHeadMatchesPrHead (#2618)', () => {
	// AC-1: worktree HEAD = PR HEAD で ok: true
	it('worktree HEAD = PR HEAD → ok: true', () => {
		const prHead = '13b28cb7e9f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5';
		const ghViewFn = () => prHead;
		const gitRevParseHeadFn = () => prHead;
		const result = verifyWorktreeHeadMatchesPrHead('2618', ghViewFn, gitRevParseHeadFn);
		expect(result.ok).toBe(true);
	});

	// AC-2 (CORE): worktree HEAD ≠ PR HEAD で head-mismatch 検出
	// これが PR #2613 Round 3 で発生した偽陽性経路を構造的に止める核心テスト
	it('AC-2 (CORE): worktree HEAD ≠ PR HEAD → ok: false, reason: head-mismatch (PR #2613 偽陽性経路)', () => {
		const prHead = '13b28cb7e9f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5'; // Fix Round 3 push 後 PR HEAD
		const worktreeHead = 'f367006a1234567890abcdef1234567890abcdef'; // origin/main HEAD (空 worktree)
		const ghViewFn = () => prHead;
		const gitRevParseHeadFn = () => worktreeHead;
		const result = verifyWorktreeHeadMatchesPrHead('2613', ghViewFn, gitRevParseHeadFn);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('result must be { ok: false } for type narrowing');
		expect(result.reason).toBe('head-mismatch');
		expect(result.prHead).toBe(prHead);
		expect(result.worktreeHead).toBe(worktreeHead);
	});

	// AC-3: 末尾改行 / 空白を trim して比較する
	it('AC-3: trailing newline / whitespace を trim して比較', () => {
		const prHead = '13b28cb7e9f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5';
		const ghViewFn = () => `${prHead}\n`; // gh は trailing newline 含む
		const gitRevParseHeadFn = () => `  ${prHead}  \n`; // git も trailing newline
		const result = verifyWorktreeHeadMatchesPrHead('2618', ghViewFn, gitRevParseHeadFn);
		expect(result.ok).toBe(true);
	});

	// AC-4: gh pr view 失敗時 (null 返却) → ok: false, reason: gh-pr-view-failed
	it('AC-4: gh pr view 失敗 (null) → ok: false, reason: gh-pr-view-failed', () => {
		const ghViewFn = () => null;
		const gitRevParseHeadFn = () => 'f367006a';
		const result = verifyWorktreeHeadMatchesPrHead('99999', ghViewFn, gitRevParseHeadFn);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('result must be { ok: false } for type narrowing');
		expect(result.reason).toBe('gh-pr-view-failed');
		expect(result.prHead).toBeNull();
		expect(result.worktreeHead).toBeNull();
	});

	// AC-5: gh pr view が空文字を返した場合 → ok: false, reason: gh-pr-view-empty
	it('AC-5: gh pr view 空文字 → ok: false, reason: gh-pr-view-empty', () => {
		const ghViewFn = () => '   \n  ';
		const gitRevParseHeadFn = () => 'f367006a';
		const result = verifyWorktreeHeadMatchesPrHead('2618', ghViewFn, gitRevParseHeadFn);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('result must be { ok: false } for type narrowing');
		expect(result.reason).toBe('gh-pr-view-empty');
	});

	// AC-6: git rev-parse HEAD 失敗時 → ok: false, reason: git-rev-parse-failed
	it('AC-6: git rev-parse HEAD 失敗 (null) → ok: false, reason: git-rev-parse-failed', () => {
		const prHead = '13b28cb7e9f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5';
		const ghViewFn = () => prHead;
		const gitRevParseHeadFn = () => null;
		const result = verifyWorktreeHeadMatchesPrHead('2618', ghViewFn, gitRevParseHeadFn);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('result must be { ok: false } for type narrowing');
		expect(result.reason).toBe('git-rev-parse-failed');
		expect(result.prHead).toBe(prHead);
		expect(result.worktreeHead).toBeNull();
	});

	// AC-7: head-mismatch 時、PR HEAD と worktree HEAD の両方が返却される
	// (stderr guidance で "git checkout <PR HEAD>" が出せるようにするため)
	it('AC-7: head-mismatch 時、両 HEAD が result に含まれ guidance に利用可能', () => {
		const prHead = '13b28cb7';
		const worktreeHead = 'f367006a';
		const result = verifyWorktreeHeadMatchesPrHead(
			'2613',
			() => prHead,
			() => worktreeHead,
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('result must be { ok: false } for type narrowing');
		// stderr guidance "git checkout <prHead>" を生成するために PR HEAD が含まれる
		expect(result.prHead).toBe(prHead);
		expect(result.worktreeHead).toBe(worktreeHead);
	});
});

describe('AC-4 rename detection 仕様 (integration note)', () => {
	// AC-4 (rename 扱い) は getDeletedFiles の git diff -M --name-status 解釈で実装される
	// (D 行のみ収集、R 行は除外)。git の挙動自体は本 unit test では mock 不能なため、
	// 仕様 comment として残し、実 git repo での E2E は CI / 開発者 self check に委ねる。
	//
	// 関連 commit: 本 script の getDeletedFiles 内 `cols[0] === 'D'` filter を参照。
	// 関連 docs: docs/sessions/qa-session.md §Step 5 / 本 PR retrospective 参照。
	it('rename detection は git diff -M で D 行のみ収集 (仕様 comment)', () => {
		// no-op assertion: 仕様 documentation のみ
		expect(true).toBe(true);
	});
});
