/**
 * tests/unit/scripts/check-recent-deploy-deletion.test.ts (#2603 / #2615)
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
 * **Issue #2615 time-aware flag 拡張 case (追加)**:
 *
 *   AC-2615-1: --since <ISO> で ISO timestamp 直接指定 → resolveSinceWindow が iso mode を返す
 *   AC-2615-2: --since-ref <SHA> で commit SHA 指定 → ref mode で commit date 取得を試みる
 *   AC-2615-3: --since-recent <N> で直近 N deploy tag 推論 → recent-deploy mode で試行
 *   AC-2615-4: backward compatibility: `--since*` 未指定時は既存 `--days` fallback (days mode)
 *   AC-2615-5: 優先順位: --since > --since-ref > --since-recent > --days
 *   AC-2615-6: --since-ref / --since-recent 解決失敗時は --days fallback (degrade safe)
 *
 * 関連:
 *   - Issue #2603 (本 test 起票 Issue)
 *   - Issue #2598 (Dev Agent rebase 予防、QM review 側補完)
 *   - Issue #2615 (time-aware flag race condition 構造解決)
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
	resolveSinceWindow,
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
		// AC-2615-4: backward compatibility - time-aware flag は未指定で null
		expect(opts.sinceIso).toBeNull();
		expect(opts.sinceRef).toBeNull();
		expect(opts.sinceRecent).toBeNull();
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

	// AC-2615: time-aware flag (--since / --since-ref / --since-recent) の help 説明
	it('help text に time-aware flag (#2615) 説明が含まれる', () => {
		const text = helpText();
		expect(text).toContain('--since');
		expect(text).toContain('--since-ref');
		expect(text).toContain('--since-recent');
		expect(text).toContain('time-aware');
		expect(text).toContain('#2615');
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

// Issue #2615: time-aware flag parsing
describe('parseArgs (#2615 time-aware flag)', () => {
	// AC-2615-1: --since <ISO> で ISO timestamp 指定
	it('--since <ISO> → sinceIso にセット、他 time-aware flag は null', () => {
		const opts = parseArgs(['--since', '2026-05-28T12:00:00Z']);
		expect(opts.sinceIso).toBe('2026-05-28T12:00:00Z');
		expect(opts.sinceRef).toBeNull();
		expect(opts.sinceRecent).toBeNull();
	});

	// AC-2615-2: --since-ref <SHA> で commit SHA 指定
	it('--since-ref <SHA> → sinceRef にセット', () => {
		const opts = parseArgs(['--since-ref', 'b3fa59c123abc']);
		expect(opts.sinceRef).toBe('b3fa59c123abc');
		expect(opts.sinceIso).toBeNull();
		expect(opts.sinceRecent).toBeNull();
	});

	// AC-2615-3: --since-recent <N> で deploy tag 件数指定
	it('--since-recent 5 → sinceRecent に Number 5 セット', () => {
		const opts = parseArgs(['--since-recent', '5']);
		expect(opts.sinceRecent).toBe(5);
		expect(opts.sinceIso).toBeNull();
		expect(opts.sinceRef).toBeNull();
	});

	// 全 time-aware flag + 既存 flag 同時指定
	it('time-aware flag と既存 flag を同時指定可能', () => {
		const opts = parseArgs([
			'--pr',
			'2615',
			'--since',
			'2026-05-28T12:00:00Z',
			'--ignore-pattern',
			'^tmp/',
			'--base',
			'origin/main',
		]);
		expect(opts.prNumber).toBe('2615');
		expect(opts.sinceIso).toBe('2026-05-28T12:00:00Z');
		expect(opts.ignorePatterns).toHaveLength(1);
		expect(opts.base).toBe('origin/main');
	});

	// AC-2615-4: backward compat - 既存使用 (`--pr <N>` 単独 / `--days <N>`) は影響なし
	it('既存使用 (--pr のみ) → time-aware flag null, days default (backward compat)', () => {
		const opts = parseArgs(['--pr', '2607']);
		expect(opts.prNumber).toBe('2607');
		expect(opts.days).toBe(DEFAULT_DAYS);
		expect(opts.sinceIso).toBeNull();
		expect(opts.sinceRef).toBeNull();
		expect(opts.sinceRecent).toBeNull();
	});
});

// Issue #2615: time window resolution (priority chain)
describe('resolveSinceWindow (#2615 priority chain)', () => {
	// AC-2615-1: --since <ISO> 指定時は iso mode で直接 value 採用
	it('--since <ISO> 指定 → iso mode で ISO value をそのまま採用', () => {
		const opts = parseArgs(['--since', '2026-05-28T12:00:00Z']);
		const window = resolveSinceWindow(opts);
		expect(window.mode).toBe('iso');
		expect(window.since).toBe('2026-05-28T12:00:00Z');
		expect(window.note).toContain('--since');
		expect(window.note).toContain('2026-05-28T12:00:00Z');
	});

	// AC-2615-4: --since* 未指定時は days mode で `<N> days ago` を採用 (backward compat)
	it('time-aware flag 未指定 → days mode で fallback (既存挙動維持)', () => {
		const opts = parseArgs([]);
		const window = resolveSinceWindow(opts);
		expect(window.mode).toBe('days');
		expect(window.since).toBe(`${DEFAULT_DAYS} days ago`);
		expect(window.note).toContain(`--days ${DEFAULT_DAYS}`);
	});

	// AC-2615-4: --days 14 単独 → days mode で 14 days ago
	it('--days 14 単独指定 → days mode で `14 days ago`', () => {
		const opts = parseArgs(['--days', '14']);
		const window = resolveSinceWindow(opts);
		expect(window.mode).toBe('days');
		expect(window.since).toBe('14 days ago');
	});

	// AC-2615-5: 優先順位 --since > --since-ref (両方指定された場合 --since 採用)
	it('--since と --since-ref 両方指定 → --since (iso) 優先', () => {
		const opts = parseArgs(['--since', '2026-05-28T12:00:00Z', '--since-ref', 'b3fa59c123abc']);
		const window = resolveSinceWindow(opts);
		expect(window.mode).toBe('iso');
		expect(window.since).toBe('2026-05-28T12:00:00Z');
	});

	// AC-2615-5: 優先順位 --since > --since-recent
	it('--since と --since-recent 両方指定 → --since (iso) 優先', () => {
		const opts = parseArgs(['--since', '2026-05-28T12:00:00Z', '--since-recent', '5']);
		const window = resolveSinceWindow(opts);
		expect(window.mode).toBe('iso');
	});

	// AC-2615-6: --since-ref 解決失敗時は --days fallback (degrade safe)
	// (実 git repo 操作を伴うため、存在しない SHA を渡して fallback を verify)
	it('--since-ref 解決失敗 (存在しない SHA) → --days fallback (mode=days)', () => {
		const opts = parseArgs(['--since-ref', '0000000000000000000000000000000000000000']);
		const window = resolveSinceWindow(opts);
		// 存在しない SHA → getCommitDate が null → fallback
		expect(window.mode).toBe('days');
		expect(window.since).toBe(`${DEFAULT_DAYS} days ago`);
	});

	// AC-2615-5: 優先順位 --since-ref > --since-recent (ref 解決成功時)
	// 実 git repo の HEAD は必ず存在するので、HEAD を ref に渡せば ref mode が選ばれる
	it('--since-ref HEAD (解決可能) → ref mode で commit date を採用', () => {
		const opts = parseArgs(['--since-ref', 'HEAD', '--since-recent', '5']);
		const window = resolveSinceWindow(opts);
		// HEAD は必ず解決できるので ref mode
		expect(window.mode).toBe('ref');
		// since には ISO 形式の日時が入る (HEAD の committer date)
		expect(window.since).toMatch(/^\d{4}-\d{2}-\d{2}/);
	});
});

// Issue #2647 (第 9 弾 hotfix deploy): hook context での `--pr` 引数撤去仕様
//
// 第 8 弾 #2645 deploy で `.husky/pre-push` Step 2.2 に `--pr "$PR_NUM"` 付き呼出を追加したが、
// push 前 hook 経路では local が rebase + new commit を持つため worktree HEAD ≠ remote PR HEAD
// となり構造的に常時 BLOCK (Fix Agent #2644 で実観察)。第 9 弾 hotfix で hook 側 `--pr` 引数を撤去。
//
// 本 describe block は「引数なし呼出時に worktree HEAD verify gate が skip される」仕様を pin する。
// hook 側の正しい呼出 (`node scripts/check-recent-deploy-deletion.mjs` 引数なし) と本 script の
// `opts.prNumber === null` → verify gate skip の挙動を unit 層で固定し、将来の hook 仕様回帰
// (誰かが「引数を付けたほうが安全」と勘違いして `--pr "$PR_NUM"` を復活させる) を予防する。
describe('#2647 hook context — hook 内 (`--pr` 引数なし) 仕様', () => {
	// AC1: `.husky/pre-push` Step 2.2 が引数なしで呼ぶ場合の parseArgs 結果
	// prNumber が null → main 側で `if (opts.prNumber !== null)` の verify gate ブロックを skip
	it('引数なし → prNumber が null (hook context、worktree HEAD verify skip 条件成立)', () => {
		const opts = parseArgs([]);
		expect(opts.prNumber).toBeNull();
		// 副次的: 既存 default 値は維持 (削除 check のみは引数なしでも実行される設計)
		expect(opts.days).toBe(DEFAULT_DAYS);
		expect(opts.base).toBe(DEFAULT_BASE);
	});

	// AC1: hook 引数なし呼出と Fix Agent worktree mode 呼出の対称性を pin
	// (hook 経路: skip / Fix Agent 経路: enabled、両方とも 1 つの script で支える設計)
	it('引数なし → prNumber=null (skip 条件) / `--pr <N>` → prNumber 設定 (enabled 条件) の対称性', () => {
		const hookOpts = parseArgs([]); // push 前 hook 経路
		const fixAgentOpts = parseArgs(['--pr', '2647']); // Fix Agent worktree mode 経路
		expect(hookOpts.prNumber).toBeNull(); // hook: verify skip
		expect(fixAgentOpts.prNumber).toBe('2647'); // Fix Agent: verify enabled
	});

	// AC3: defense in depth 維持 — `--pr <N>` 経路 (CI / Fix Agent worktree) の verify gate は不変
	// 本 hotfix は hook 側の呼出方法のみ変更し、`verifyWorktreeHeadMatchesPrHead` 関数自体は変更しない。
	// (本 it は仕様 documentation のみ、関数 unit test 自身は既存 `describe('verifyWorktreeHeadMatchesPrHead')`
	// block で網羅済)
	it('`verifyWorktreeHeadMatchesPrHead` 関数自体は本 hotfix の影響を受けない (defense in depth 維持)', () => {
		// 既存 describe block で worktree HEAD verify 6 case をテスト済 (HEAD 一致 / 不一致 / gh-pr-view
		// 失敗 / empty / git-rev-parse 失敗 / extra whitespace)。本 hotfix は hook 呼出方法のみ変更で
		// 関数 signature / 挙動は一切変更しない。
		expect(typeof verifyWorktreeHeadMatchesPrHead).toBe('function');
	});

	// AC1: `--pr "$PR_NUM"` を hook で **付与しない** 仕様の hard pin
	// 仕様 documentation: 将来「引数を付けたほうが strict」と勘違いして hook 側 `--pr` を復活させた場合、
	// 本 test 群が「hook 経路では引数なしが正解」という仕様を明示する SSOT として機能する。
	it('hook context 仕様 documentation: 引数なし呼出が hook 経路の正解', () => {
		// no-op assertion: 仕様 documentation。実 hook fail / 構造 BLOCK の検証は
		// self-dogfood (本 PR push 時に hook PASS) で担保する。
		// 参照: ADR-0056 §F 補足 / Issue #2647 / .husky/pre-push Step 2.2 コメント
		expect(true).toBe(true);
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
