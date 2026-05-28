#!/usr/bin/env node

/**
 * scripts/check-recent-deploy-deletion.mjs (#2603)
 *
 * QM Tier 2 Review Step 5 (semantic 承認判断) に、本 PR diff が
 * **直近 7 日 (configurable) に main に merge された file を削除していないか**
 * を機械検証するための gate script。
 *
 * **背景**:
 *
 * 2026-05-28 単日で「rebase drift で PR が main 進化を取り込まずに古い base から
 * 派生 → diff に過去 merge revert を混入」する事象が 5 連続再発 (#2582 / #2595 /
 * #2598 / #2602 / #2560)。特に #2602 / #2560 では本日 deploy した PR #2599
 * (ADR-0056 + QM drift prevention 案 1) 関連 file を削除する状態で Review Agent
 * が事前 gate 発火。既存 #2598 (Dev Agent rebase 予防 SKILL) は Dev 側 SKILL で
 * 構造的に弱く、本 script は QM review 側の machine-verify gate を追加して
 * Defense in Depth を確立する。
 *
 * **time-aware flag 拡張 (#2615)**:
 *
 * 2026-05-28 / 29 にかけ PR #2607 Round 5 で **race condition 4 ラウンド連続 BLOCK**
 * を観察 (本日 deploy 19 件 / 6h = ~18min/commit + Fix Agent → QM Re-Review turnaround
 * 5-30min)。Time-of-Check vs Time-of-Use race:
 *   - Fix Agent push 時の `origin/main` (M1) と Re-Review 開始時の `origin/main` (M2)
 *     が異なり、`days` 全体比較では M2 で新規追加された file まで含めて compare → 偽陽性
 * 対処として `--since <ISO>` / `--since-ref <SHA>` / `--since-recent <N>` で
 * 時間 window を限定する flag を追加。指定時刻 / commit / 直近 N deploy tag 以降の
 * merge file のみを比較対象にし、main 進化 (新規追加) は本 PR の責任ではないので除外。
 *
 * **設計根拠** (本 script 自身の justification):
 *
 * - **arXiv:2412.00804 (Persona Drift)**: identity drift しても機械検証で gate
 * - **ADR-0056 §結果 escalate trigger**: 案 1 deploy 自身の保全機構
 * - **ADR-0010 Pre-PMF Bucket A**: 本日 5 連続再発 + race condition 4 連続観察 =
 *   実観察 defect への直接対処
 *
 * **判定ロジック**:
 *
 * 1. `git merge-base origin/main HEAD` を取得し、`origin/main..HEAD` の削除 file を列挙
 * 2. 直近 N 日 (default 7) に main に merge された commit (`--merges`) を `git log` で取得
 * 3. 各 merge commit が touch した file (additions / modifications / deletions 不問) と
 *    PR の削除 file を path level で照合
 * 4. 重複 file が存在し、かつ `--ignore-pattern` regex にマッチしない場合 → exit 2
 *    + stderr に違反 listing (file:commit:date)
 * 5. 重複なし → exit 0
 *
 * **Edge cases**:
 *
 * - **rename detection (false positive 回避)**: `git diff --diff-filter=R` で rename と
 *   検出された file は削除扱いしない (archive 移動 1-in-1-out 等 legitimate な move を
 *   保護)。`git diff -M` を明示し similarity ≥ 50% を rename と判定。
 * - **archive 移動 (1-in-1-out)**: `--ignore-pattern '^docs/decisions/archive/'` で
 *   除外可能 (legitimate な ADR archive 移動を許容)。
 * - **window 外**: 直近 N 日内 merge のみ対象。古い merge commit の file 削除は drift
 *   ではなく意図的 cleanup の可能性が高いため対象外。
 *
 * **CLI 引数**:
 *
 *   --pr <number>            対象 PR 番号 (報告 / verify メッセージ用、省略時は HEAD)
 *   --days <N>               遡及 window 日数 (default 7、`--since*` 未指定時のみ有効)
 *   --since <ISO>            指定時刻以降の main merge のみ対象 (例: 2026-05-28T12:00:00Z)
 *                            time-aware mode、`--days` より優先 (#2615)
 *   --since-ref <SHA>        指定 commit (の committer date) 以降の main merge のみ対象
 *                            time-aware mode、`--days` より優先 (#2615)
 *   --since-recent <N>       直近 N 件の `deploy-YYYYMMDD-HHMMSS-<sha>` tag 以降の main
 *                            merge のみ対象 (deploy tag pattern 推論、default 5)
 *                            time-aware mode、`--days` より優先 (#2615)
 *   --ignore-pattern <regex> 除外 path regex (複数指定可、繰り返し)
 *   --base <ref>             比較 base (default origin/main)
 *   --help                   この help を表示
 *
 * **環境変数 (CLI 引数の代替)**:
 *
 *   RECENT_DEPLOY_CHECK_DAYS  default 7
 *   RECENT_DEPLOY_CHECK_BASE  default origin/main
 *
 * **exit**:
 *
 *   0 = OK (直近 deploy file を削除していない / 削除があっても全て ignore-pattern にマッチ)
 *   2 = 直近 deploy file の削除を検出 (BLOCK)
 *   3 = internal error (git 失敗 / base ref 不在 等 + **worktree HEAD ≠ PR HEAD mismatch (#2618)**)
 *
 * **想定実行環境**:
 *
 *   - QM Tier 2 Review Agent (Step 5 D 項目、approve 直前 gate)
 *   - 開発者 local (PR 作成前 self check)
 *   - 将来 CI gate 化 (GitHub Actions の pr-quality-gate.yml に追加検討)
 *
 * **テスト**: `tests/unit/scripts/check-recent-deploy-deletion.test.ts` (vitest)
 *
 * **#2618: worktree HEAD verify gate (機構運用層 self-defense、ADR-0056 §D)**:
 *
 *   `--pr <N>` 指定時は本体実行前に `gh pr view <N> --json headRefOid` で PR HEAD を取得し、
 *   `git rev-parse HEAD` (worktree HEAD) と一致を verify する。不一致なら exit 3 + 「PR HEAD
 *   を明示 checkout してください」guidance。Fix Agent worktree で `origin/main` HEAD 空 worktree
 *   で本 gate を回した際に削除 file 0 件と誤認する偽陽性 (PR #2613 Round 3 で legal critical 506
 *   行喪失寸前) への defense in depth。`--pr` 省略時は HEAD 検証を skip (gh CLI 不要、開発者
 *   local の単独 self-check 互換)。
 *
 * **関連**:
 *   - Issue #2603 (本 script 起票 Issue、5 連続再発の構造的予防)
 *   - Issue #2598 (Dev Agent rebase 予防 SKILL、本 script は QM review 側補完)
 *   - Issue #2618 (機構運用層 bypass 防止、本 worktree HEAD verify gate の起票元)
 *   - ADR-0056 (QM drift prevention 案 1、本 script 自身が deploy 保全機構)
 *   - ADR-0056 §D (機構運用層 bypass 防止、本 verify は §D の defense in depth 実装)
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DAYS = 7;
export const DEFAULT_BASE = 'origin/main';

/**
 * @typedef {object} MergeEntry
 * @property {string} commit
 * @property {string} date
 * @property {string[]} files
 */

/**
 * @typedef {object} CliOptions
 * @property {string | null} prNumber
 * @property {number} days
 * @property {string | null} sinceIso     `--since <ISO>` time-aware mode (#2615)
 * @property {string | null} sinceRef     `--since-ref <SHA>` time-aware mode (#2615)
 * @property {number | null} sinceRecent  `--since-recent <N>` time-aware mode (#2615)
 * @property {RegExp[]} ignorePatterns
 * @property {string} base
 * @property {boolean} help
 */

/**
 * git コマンドを実行し stdout を返す。exit code != 0 で null を返す。
 *
 * @param {string[]} args git 引数
 * @param {object} options spawnSync options
 * @returns {string|null}
 */
export function runGit(args, options = {}) {
	// IMPORTANT: shell:false を強制する。Windows で shell:true にすると
	// `--pretty=format:__COMMIT__%H|%ai` の `|%ai` が pipe + 環境変数として
	// shell に解釈され git log が status=255 で失敗する (`%ai` is not recognized
	// as an internal or external command)。`git` 自体は Node の child_process が
	// PATH lookup するので shell 経由不要。
	const result = spawnSync('git', args, {
		encoding: 'utf8',
		shell: false,
		...options,
	});
	if (result.status !== 0) {
		return null;
	}
	return result.stdout ?? '';
}

/**
 * PR diff から削除 file 一覧を取得する。
 *
 * `git diff -M --name-status <base>..HEAD` を実行し、
 *   - 'D' status の file → 削除 file として収集
 *   - 'R' status の file → rename として除外 (legitimate な move を保護、archive 移動等)
 *
 * @param {string} base 比較 base (例: 'origin/main')
 * @returns {string[]|null} 削除 file path 配列、git 失敗時 null
 */
export function getDeletedFiles(base) {
	const output = runGit(['diff', '-M', '--name-status', `${base}..HEAD`]);
	if (output === null) {
		return null;
	}
	/** @type {string[]} */
	const deleted = [];
	for (const line of output.split(/\r?\n/)) {
		if (!line) continue;
		// 'D\tpath/to/file' 形式。rename は 'R<similarity>\told\tnew' 形式 (3 cols) で除外
		const cols = line.split('\t');
		const status = cols[0];
		const filePath = cols[1];
		if (cols.length === 2 && status === 'D' && typeof filePath === 'string') {
			deleted.push(filePath);
		}
		// rename ('R100' / 'R85' 等) は skip
	}
	return deleted;
}

/**
 * 指定 commit SHA の committer date (ISO 8601) を取得する (#2615)。
 *
 * @param {string} ref commit SHA / branch name
 * @returns {string | null} ISO 8601 committer date、解決失敗時 null
 */
export function getCommitDate(ref) {
	const output = runGit(['log', '-1', '--pretty=format:%cI', ref]);
	if (output === null) return null;
	const trimmed = output.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * 直近 N 件の `deploy-YYYYMMDD-HHMMSS-<sha>` tag を取得し、その中で最も古い tag の
 * commit date (ISO 8601) を返す (#2615)。
 *
 * tag 命名規約は本 repo の deploy 運用 (`deploy-YYYYMMDD-HHMMSS-<short_sha>`、本日 11 件
 * 観察済) に依存。マッチする tag が 0 件の場合は null を返し、呼び出し側で fallback
 * (`--days`) に切替えるべき。
 *
 * @param {number} count 直近何件の deploy tag を window にするか (例: 5)
 * @returns {string | null} 最古 deploy tag の commit ISO 日時、tag 0 件で null
 */
export function getSinceFromRecentDeployTags(count) {
	// git tag --list "deploy-*" --sort=-creatordate を使って新しい順に取得
	const output = runGit(['tag', '--list', 'deploy-*', '--sort=-creatordate']);
	if (output === null) return null;
	const tags = output
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => /^deploy-\d{8}-\d{6}-[0-9a-f]+$/.test(l));
	if (tags.length === 0) return null;
	// 直近 count 件のうち最も古い (= index = min(count, length) - 1) の tag を境界に
	const boundaryIdx = Math.min(count, tags.length) - 1;
	const boundaryTag = tags[boundaryIdx];
	if (!boundaryTag) return null;
	return getCommitDate(boundaryTag);
}

/**
 * CLI options から time window (`--since=<git log spec>`) を解決する (#2615)。
 *
 * 優先順位 (高 → 低):
 *   1. `--since <ISO>`      指定 ISO timestamp をそのまま使用
 *   2. `--since-ref <SHA>`  ref の commit date を取得して使用
 *   3. `--since-recent <N>` 直近 N deploy tag のうち最古の commit date を使用
 *   4. fallback             `<days> days ago` (既存 backward compat)
 *
 * @param {CliOptions} opts CLI parse 結果
 * @returns {{since: string, mode: 'iso' | 'ref' | 'recent-deploy' | 'days', note: string}}
 *   解決後の `--since=` value と debug 用 mode/note。
 *   解決失敗時は fallback の `<days> days ago` に degrade する。
 */
export function resolveSinceWindow(opts) {
	if (opts.sinceIso) {
		return { since: opts.sinceIso, mode: 'iso', note: `--since ${opts.sinceIso}` };
	}
	if (opts.sinceRef) {
		const date = getCommitDate(opts.sinceRef);
		if (date) {
			return { since: date, mode: 'ref', note: `--since-ref ${opts.sinceRef} (${date})` };
		}
		// ref 解決失敗時は fallback (本来は exit すべきだが backward compat 優先)
	}
	if (typeof opts.sinceRecent === 'number' && opts.sinceRecent > 0) {
		const date = getSinceFromRecentDeployTags(opts.sinceRecent);
		if (date) {
			return {
				since: date,
				mode: 'recent-deploy',
				note: `--since-recent ${opts.sinceRecent} (${date})`,
			};
		}
		// deploy tag 0 件で fallback
	}
	return {
		since: `${opts.days} days ago`,
		mode: 'days',
		note: `--days ${opts.days}`,
	};
}

/**
 * 直近 N 日に main に merge された commit から、touch した file 一覧を収集する。
 *
 * `git log --merges --since=<N days ago> --name-only --pretty='format:%H|%ai' <base>`
 * を実行。各 merge commit ごとに { commit, date, files: [] } を返す。
 *
 * @param {string} base 対象 ref (例: 'origin/main')
 * @param {number} days 遡及日数
 * @returns {Array<{commit: string, date: string, files: string[]}>|null}
 */
export function getRecentMergedFiles(base, days) {
	return getMergedFilesSince(base, `${days} days ago`);
}

/**
 * 任意の `--since=<spec>` (git log の `--since=` accepts ISO 8601 / `N days ago`
 * / human-readable strings) に基づき main の merged file 一覧を収集する (#2615)。
 *
 * `getRecentMergedFiles(base, days)` の内部実装としても利用される (`days` を
 * `${N} days ago` に組み立てて pass)。time-aware mode (`--since` / `--since-ref`
 * / `--since-recent`) では ISO timestamp が直接渡される。
 *
 * @param {string} base 対象 ref (例: 'origin/main')
 * @param {string} sinceSpec git log `--since=` の値 (ISO 8601 / `N days ago` 等)
 * @returns {Array<{commit: string, date: string, files: string[]}>|null}
 */
export function getMergedFilesSince(base, sinceSpec) {
	const output = runGit([
		'log',
		'--merges',
		`--since=${sinceSpec}`,
		'--name-only',
		'--pretty=format:__COMMIT__%H|%ai',
		base,
	]);
	if (output === null) {
		return null;
	}
	/** @type {MergeEntry[]} */
	const merges = [];
	/** @type {MergeEntry | null} */
	let current = null;
	for (const line of output.split(/\r?\n/)) {
		if (line.startsWith('__COMMIT__')) {
			if (current) merges.push(current);
			const [sha, date] = line.replace('__COMMIT__', '').split('|');
			current = { commit: sha ?? '', date: date ?? '', files: [] };
		} else if (line && current) {
			current.files.push(line);
		}
	}
	if (current) merges.push(current);

	// Also include non-merge commits on main within the window (squash merges land as
	// regular commits on main, not as --merges). We collect their touched files too.
	const squashOutput = runGit([
		'log',
		'--no-merges',
		`--since=${sinceSpec}`,
		'--name-only',
		'--pretty=format:__COMMIT__%H|%ai',
		base,
	]);
	if (squashOutput !== null) {
		/** @type {MergeEntry | null} */
		let squashCurrent = null;
		for (const line of squashOutput.split(/\r?\n/)) {
			if (line.startsWith('__COMMIT__')) {
				if (squashCurrent) merges.push(squashCurrent);
				const [sha, date] = line.replace('__COMMIT__', '').split('|');
				squashCurrent = { commit: sha ?? '', date: date ?? '', files: [] };
			} else if (line && squashCurrent) {
				squashCurrent.files.push(line);
			}
		}
		if (squashCurrent) merges.push(squashCurrent);
	}

	return merges;
}

/**
 * 削除 file が ignore-pattern にマッチするかを判定する。
 *
 * @param {string} filePath
 * @param {RegExp[]} ignorePatterns
 * @returns {boolean}
 */
export function isIgnored(filePath, ignorePatterns) {
	return ignorePatterns.some((re) => re.test(filePath));
}

/**
 * worktree HEAD と PR HEAD の一致を verify する純粋関数 (#2618、ADR-0056 §D)。
 *
 * Fix Agent worktree モードで `origin/main` HEAD 空 worktree のまま本 gate を呼ぶと
 * `origin/main..HEAD` diff が空 → 削除 file 0 件 → 偽陽性 exit 0 となる。本関数は
 * 入力された worktree HEAD と PR HEAD を厳格比較し、不一致を機構運用層で検出する。
 *
 * @param {string} prNumber 対象 PR 番号 (string、`--pr` 値)
 * @param {(args: string[]) => string|null} ghViewFn `gh pr view --json headRefOid -q .headRefOid` 相当を返す関数 (test injectable)
 * @param {() => string|null} gitRevParseHeadFn `git rev-parse HEAD` 相当を返す関数 (test injectable)
 * @returns {{ ok: true } | { ok: false, reason: string, prHead: string|null, worktreeHead: string|null }}
 */
export function verifyWorktreeHeadMatchesPrHead(prNumber, ghViewFn, gitRevParseHeadFn) {
	const prHeadRaw = ghViewFn(['pr', 'view', prNumber, '--json', 'headRefOid', '-q', '.headRefOid']);
	if (prHeadRaw === null) {
		return {
			ok: false,
			reason: 'gh-pr-view-failed',
			prHead: null,
			worktreeHead: null,
		};
	}
	const prHead = prHeadRaw.trim();
	if (prHead === '') {
		return {
			ok: false,
			reason: 'gh-pr-view-empty',
			prHead: null,
			worktreeHead: null,
		};
	}
	const worktreeHeadRaw = gitRevParseHeadFn();
	if (worktreeHeadRaw === null) {
		return {
			ok: false,
			reason: 'git-rev-parse-failed',
			prHead,
			worktreeHead: null,
		};
	}
	const worktreeHead = worktreeHeadRaw.trim();
	if (prHead !== worktreeHead) {
		return {
			ok: false,
			reason: 'head-mismatch',
			prHead,
			worktreeHead,
		};
	}
	return { ok: true };
}

/**
 * 違反検出のコアロジック。
 *
 * @param {string[]} deletedFiles PR 側の削除 file
 * @param {Array<{commit: string, date: string, files: string[]}>} recentMerges 直近 merge commits
 * @param {RegExp[]} ignorePatterns
 * @returns {Array<{file: string, commit: string, date: string}>} 違反 (filtered) 一覧
 */
export function findViolations(deletedFiles, recentMerges, ignorePatterns) {
	const violations = [];
	const deletedSet = new Set(deletedFiles);
	for (const merge of recentMerges) {
		for (const file of merge.files) {
			if (deletedSet.has(file) && !isIgnored(file, ignorePatterns)) {
				violations.push({
					file,
					commit: merge.commit.slice(0, 8),
					date: merge.date,
				});
			}
		}
	}
	return violations;
}

/**
 * CLI 引数を parse する。
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {CliOptions}
 */
export function parseArgs(argv) {
	/** @type {CliOptions} */
	const opts = {
		prNumber: null,
		days: Number(process.env.RECENT_DEPLOY_CHECK_DAYS ?? DEFAULT_DAYS),
		sinceIso: null,
		sinceRef: null,
		sinceRecent: null,
		ignorePatterns: [],
		base: process.env.RECENT_DEPLOY_CHECK_BASE ?? DEFAULT_BASE,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = argv[i + 1];
		if (arg === '--help' || arg === '-h') {
			opts.help = true;
		} else if (arg === '--pr' && typeof next === 'string') {
			opts.prNumber = next;
			i++;
		} else if (arg === '--days' && typeof next === 'string') {
			opts.days = Number(next);
			i++;
		} else if (arg === '--since' && typeof next === 'string') {
			opts.sinceIso = next;
			i++;
		} else if (arg === '--since-ref' && typeof next === 'string') {
			opts.sinceRef = next;
			i++;
		} else if (arg === '--since-recent' && typeof next === 'string') {
			opts.sinceRecent = Number(next);
			i++;
		} else if (arg === '--ignore-pattern' && typeof next === 'string') {
			opts.ignorePatterns.push(new RegExp(next));
			i++;
		} else if (arg === '--base' && typeof next === 'string') {
			opts.base = next;
			i++;
		}
	}
	return opts;
}

/**
 * help テキストを返す。
 */
export function helpText() {
	return [
		'Usage: node scripts/check-recent-deploy-deletion.mjs [options]',
		'',
		'  --pr <number>            対象 PR 番号 (報告メッセージ用)',
		'  --days <N>               遡及 window 日数 (default 7、`--since*` 未指定時のみ有効)',
		'  --since <ISO>            time-aware mode: 指定 ISO 時刻以降の merge のみ対象 (#2615)',
		'  --since-ref <SHA>        time-aware mode: 指定 commit 以降の merge のみ対象 (#2615)',
		'  --since-recent <N>       time-aware mode: 直近 N 件の deploy tag 以降のみ対象 (#2615)',
		'  --ignore-pattern <regex> 除外 path regex (繰り返し可)',
		'  --base <ref>             比較 base (default origin/main)',
		'  --help                   この help',
		'',
		'Exit codes:',
		'  0 = OK',
		'  2 = 直近 deploy file 削除を検出 (BLOCK)',
		'  3 = internal error または worktree HEAD ≠ PR HEAD mismatch (#2618)',
		'',
		'#2618 / ADR-0056 §D: --pr 指定時は worktree HEAD = PR HEAD verify が走り、',
		'  不一致時は exit 3 で BLOCK (機構運用層 bypass 防止、Fix Agent 偽陽性対策)。',
		'',
		'See docs/sessions/qa-session.md §Step 5 / Issue #2603 / #2615 (time-aware) / #2618 (worktree verify) for context.',
	].join('\n');
}

/**
 * `gh` コマンドを実行し stdout を返す。exit code != 0 で null を返す。
 *
 * @param {string[]} args gh 引数
 * @returns {string|null}
 */
function runGh(args) {
	const result = spawnSync('gh', args, {
		encoding: 'utf8',
		shell: false,
	});
	if (result.status !== 0) {
		return null;
	}
	return result.stdout ?? '';
}

/**
 * main entry point。CLI 実行時のみ呼ばれる (vitest 経由では skip)。
 */
async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		process.stdout.write(`${helpText()}\n`);
		return 0;
	}

	// #2618 / ADR-0056 §D: worktree HEAD verify gate (機構運用層 self-defense)
	// `--pr` 指定時のみ verify (省略時は gh CLI 不要、開発者 local self-check 互換)。
	if (opts.prNumber !== null) {
		const verifyResult = verifyWorktreeHeadMatchesPrHead(
			opts.prNumber,
			(args) => runGh(args),
			() => runGit(['rev-parse', 'HEAD']),
		);
		if (!verifyResult.ok) {
			process.stderr.write(
				`[check-recent-deploy-deletion] FAIL: worktree HEAD verify failed (reason=${verifyResult.reason}, PR #${opts.prNumber}).\n`,
			);
			if (verifyResult.reason === 'head-mismatch') {
				process.stderr.write(`  worktree HEAD: ${verifyResult.worktreeHead}\n`);
				process.stderr.write(`  PR HEAD:       ${verifyResult.prHead}\n`);
				process.stderr.write(
					`  対処: PR HEAD を明示 checkout してください (git checkout ${verifyResult.prHead}).\n`,
				);
			} else if (
				verifyResult.reason === 'gh-pr-view-failed' ||
				verifyResult.reason === 'gh-pr-view-empty'
			) {
				process.stderr.write(
					`  対処: 'gh auth status' で gh CLI 認証を verify し、PR ${opts.prNumber} が存在するか確認してください。\n`,
				);
			} else if (verifyResult.reason === 'git-rev-parse-failed') {
				process.stderr.write(
					`  対処: 現在の cwd が git worktree 内か確認してください ('git rev-parse HEAD').\n`,
				);
			}
			process.stderr.write(
				`  根拠: Issue #2618 (機構運用層 bypass 防止 / 昨日 PR #2613 で legal critical 506 行喪失寸前まで進んだ実害観察) / ADR-0056 §D.\n`,
			);
			return 3;
		}
	}

	const deletedFiles = getDeletedFiles(opts.base);
	if (deletedFiles === null) {
		process.stderr.write(
			`[check-recent-deploy-deletion] ERROR: git diff failed for base=${opts.base}. base ref not found?\n`,
		);
		return 3;
	}

	if (deletedFiles.length === 0) {
		process.stdout.write(
			`[check-recent-deploy-deletion] OK: no deleted files in ${opts.base}..HEAD${opts.prNumber ? ` (PR #${opts.prNumber})` : ''}.\n`,
		);
		return 0;
	}

	// #2615: resolve time-aware window (--since / --since-ref / --since-recent) or fallback to --days
	const window = resolveSinceWindow(opts);
	const recentMerges = getMergedFilesSince(opts.base, window.since);
	if (recentMerges === null) {
		process.stderr.write(
			`[check-recent-deploy-deletion] ERROR: git log failed for base=${opts.base} since=${window.since}.\n`,
		);
		return 3;
	}

	const violations = findViolations(deletedFiles, recentMerges, opts.ignorePatterns);

	if (violations.length === 0) {
		process.stdout.write(
			`[check-recent-deploy-deletion] OK: ${deletedFiles.length} file(s) deleted, none overlap with merges since ${window.note}${opts.prNumber ? ` (PR #${opts.prNumber})` : ''}.\n`,
		);
		return 0;
	}

	process.stderr.write(
		`[check-recent-deploy-deletion] BLOCK: ${violations.length} file(s) deleted that were touched by main merges since ${window.note}${opts.prNumber ? ` (PR #${opts.prNumber})` : ''}.\n`,
	);
	process.stderr.write('  This is the typical symptom of rebase drift (#2603 / 5 連続再発).\n');
	process.stderr.write(
		'  Fix: `git rebase origin/main` (or `git merge origin/main`) before pushing.\n\n',
	);
	for (const v of violations) {
		process.stderr.write(`  - ${v.file}\n    └ touched by ${v.commit} (${v.date})\n`);
	}
	process.stderr.write('\n');
	process.stderr.write('If a deletion is intentional (e.g. ADR archive move, 1-in-1-out),\n');
	process.stderr.write(
		'  rerun with `--ignore-pattern <regex>` (e.g. `^docs/decisions/archive/`).\n',
	);
	return 2;
}

// CLI 実行時のみ main を呼ぶ (vitest import 時は skip)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().then((code) => process.exit(code));
}
