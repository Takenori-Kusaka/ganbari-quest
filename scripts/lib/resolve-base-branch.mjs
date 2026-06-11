#!/usr/bin/env node
/**
 * scripts/lib/resolve-base-branch.mjs — Issue #2959 (#2870 follow-up)
 *
 * develop 二層ブランチ戦略 (docs/sessions/branch-strategy.md §3/§5) における
 * 「現在の branch がどの base branch に向かうべきか」のクライアント側 SSOT。
 *
 * cutover (2026-06-05、#2870) 後、feature/fix/docs PR は develop 向け・hotfix (fix/*) は
 * main 向けの 2 レーンが併存する。`.husky/pre-push` の drift 検査 / `scripts/pre-ready.mjs` の
 * 変更ファイル検出が `origin/main` ハードコードのままだと、develop が main から乖離した時点で
 * 誤ブロック / 誤検出が構造的に発生する (#2959 根本原因)。
 *
 * 解決順序 (決定的、上から最初に確定したものを採用):
 *   1. env `GANBARI_PR_BASE` 明示指定 (hotfix の初回 push 用 escape hatch)
 *   2. 現 branch に open PR が存在すれば、その baseRefName (最も権威ある情報)
 *   3. `origin/develop` 不在 → main (cutover 前 repo / clone 直後への後方互換)
 *   4. 現 branch == develop → main (統合 PR レーン)
 *   5. branch が develop 固有 commit を含む → develop (develop 基点 feature branch)
 *   6. それ以外 → main (main 基点 hotfix、または develop == main で等価)
 *
 * CI 側 gate の lane 判定 (Phase A #2943 `scripts/pr-lane.mjs`) とは
 * 「サーバ gate 用 (PR event payload 基点)」/「クライアント tooling 用 (local git 基点)」で
 * 責務が異なる。#2943 実装時に統合可否を再評価する (Issue #2959 related 記載)。
 *
 * Usage (CLI):
 *   node scripts/lib/resolve-base-branch.mjs            # => "develop" または "main" を stdout に出力
 *   node scripts/lib/resolve-base-branch.mjs --verify-base  # 基点鮮度検証 (#2975 AC2): HEAD が
 *                                                           # origin/<base> 最新を取り込んでいなければ exit 1
 *   GANBARI_PR_BASE=main node scripts/lib/resolve-base-branch.mjs
 *
 * exit: 0 = 解決成功 / 1 = git 情報取得不能 (呼び出し側は main に fallback すること)
 *       --verify-base 時は「HEAD が origin/<base> より遅れている (stale base)」でも 1
 *
 * #2975 (single-branch refspec self-heal):
 *   `git clone --single-branch` 由来の main 限定 refspec だと `git fetch origin develop` しても
 *   refs/remotes/origin/develop が更新されず、stale develop 基点ズレ (16 commits 遅れ事故 2 回) と
 *   pre-push drift verify の偽 PASS が構造的に発生する。resolveBaseBranchAuto() の冒頭で
 *   ensureDevelopRefspec() が refspec を自己修復するため、本 SSOT を経由する全経路
 *   (.husky/pre-push Step 2.0 / scripts/pre-ready.mjs) に self-heal が波及する。
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * base branch 解決の純粋関数 (unit test 対象、Issue #2959 AC1)。
 *
 * @param {{
 *   envBase: string | null;        // env GANBARI_PR_BASE (未設定は null)
 *   prBase: string | null;         // 現 branch の open PR の baseRefName (PR 不在は null)
 *   currentBranch: string;         // 現 branch 名 (例: 'feat/123-foo' / 'develop')
 *   hasDevelop: boolean;           // origin/develop が存在するか
 *   containsDevelopOnlyCommits: boolean; // merge-base(HEAD, origin/develop) != merge-base(origin/main, origin/develop)
 * }} input
 * @returns {'develop' | 'main' | string}
 */
export function resolveBaseBranch({
	envBase,
	prBase,
	currentBranch,
	hasDevelop,
	containsDevelopOnlyCommits,
}) {
	// 1. 明示指定が最優先 (hotfix の初回 push 用 escape hatch)
	if (envBase) return envBase.replace(/^origin\//, '');
	// 2. open PR の baseRefName が最も権威ある情報
	if (prBase) return prBase;
	// 3. develop 不在なら従来どおり main (cutover 前 / clone 直後互換)
	if (!hasDevelop) return 'main';
	// 4. develop 自身は main へ向かう (統合 PR レーン)
	if (currentBranch === 'develop') return 'main';
	// 5. develop 固有 commit を含む branch は develop 基点の feature branch
	if (containsDevelopOnlyCommits) return 'develop';
	// 6. それ以外 = main 基点 hotfix、または develop == main (どちらでも等価)
	return 'main';
}

/**
 * remote.origin.fetch の refspec 行が origin/develop の追跡を含むかの純粋判定 (#2975、unit test 対象)。
 * `+refs/heads/*:refs/remotes/origin/*` (全 branch) または develop 明示行があれば true。
 *
 * @param {string[]} refspecLines `git config --get-all remote.origin.fetch` の行配列
 * @returns {boolean}
 */
export function refspecCoversDevelop(refspecLines) {
	return refspecLines.some((line) => {
		const src = line.replace(/^\+/, '').split(':')[0].trim();
		return src === 'refs/heads/*' || src === 'refs/heads/develop';
	});
}

/**
 * single-branch refspec の自己修復 (#2975 AC1)。
 * remote.origin.fetch に develop を追跡する refspec が無い場合、remote に develop が実在することを
 * 確認した上で refspec 追加 + fetch する。worktree は main repo と git config を共有するため、
 * 修復は clone 単位で 1 回だけ走る (以後 refspecCoversDevelop が true で即 return)。
 *
 * - offline / remote に develop 不在 (cutover 前 repo 互換) → 何もしない (従来挙動維持)
 * - 修復失敗は呼び出し側の base 解決を妨げない (throw しない)
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {boolean} true = refspec を修復した
 */
export function ensureDevelopRefspec(opts = {}) {
	const cwd = opts.cwd ?? process.cwd();
	const run = (cmd, timeout) =>
		execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout }).trim();

	let lines = [];
	try {
		lines = run('git config --get-all remote.origin.fetch')
			.split('\n')
			.filter((l) => l.trim() !== '');
	} catch {
		return false; // origin 未設定等 — 解決は従来どおり進める
	}
	if (lines.length === 0 || refspecCoversDevelop(lines)) return false;

	try {
		// remote に develop が実在する場合のみ修復 (不在 remote へ refspec を足すと fetch が壊れる)
		const lsRemote = run('git ls-remote --heads origin develop', 15_000);
		if (!lsRemote) return false;
		run('git config --add remote.origin.fetch "+refs/heads/develop:refs/remotes/origin/develop"');
	} catch {
		return false; // offline / ls-remote 失敗 — 修復見送り
	}
	try {
		run('git fetch origin develop', 30_000);
	} catch {
		// fetch 失敗 (一時的 offline 等) でも refspec 追加自体は有効 — 次回 fetch で追跡される
	}
	return true;
}

/**
 * git / gh から解決入力を収集して resolveBaseBranch を呼ぶ。
 * git 情報が取得できない場合は throw する (呼び出し側で main fallback)。
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string} 解決された base branch 名 ('develop' | 'main')
 */
export function resolveBaseBranchAuto(opts = {}) {
	const cwd = opts.cwd ?? process.cwd();
	/** @param {string} args git サブコマンド文字列 (固定引数のみ、ユーザー入力は通さない) */
	const git = (args) =>
		execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

	// #2975 AC1: single-branch refspec self-heal。base 解決前に origin/develop の追跡を保証し、
	// stale develop 基点ズレ + pre-push drift verify 偽 PASS を構造的に防ぐ。
	try {
		ensureDevelopRefspec({ cwd });
	} catch {
		// self-heal 失敗でも解決は継続 (従来挙動と同一の fallback 経路)
	}

	const envBase = process.env.GANBARI_PR_BASE?.trim() || null;
	if (envBase) {
		return resolveBaseBranch({
			envBase,
			prBase: null,
			currentBranch: '',
			hasDevelop: false,
			containsDevelopOnlyCommits: false,
		});
	}

	const currentBranch = git('rev-parse --abbrev-ref HEAD');

	// open PR の baseRefName (gh 未認証 / PR 不在 / offline は null)
	let prBase = null;
	try {
		prBase =
			execSync('gh pr view --json baseRefName -q .baseRefName', {
				cwd,
				encoding: 'utf-8',
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 15_000,
			}).trim() || null;
	} catch {
		prBase = null;
	}

	let hasDevelop = true;
	try {
		git('rev-parse --verify --quiet origin/develop');
	} catch {
		hasDevelop = false;
	}

	let containsDevelopOnlyCommits = false;
	if (hasDevelop && !prBase) {
		try {
			const mbHeadDevelop = git('merge-base HEAD origin/develop');
			const mbMainDevelop = git('merge-base origin/main origin/develop');
			containsDevelopOnlyCommits = mbHeadDevelop !== mbMainDevelop;
		} catch {
			containsDevelopOnlyCommits = false;
		}
	}

	return resolveBaseBranch({
		envBase: null,
		prBase,
		currentBranch,
		hasDevelop,
		containsDevelopOnlyCommits,
	});
}

const isMain = (() => {
	try {
		return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	try {
		const base = resolveBaseBranchAuto();
		if (process.argv.includes('--verify-base')) {
			// #2975 AC2: 基点鮮度の機械検証。branch 作成直後 / push 前に
			// 「HEAD が origin/<base> の最新を取り込んでいる (behind 0)」ことを exit code で保証する。
			if (!/^[\w./-]+$/.test(base)) {
				console.error(`[resolve-base-branch] ERROR: 不正な base branch 名: ${base}`);
				process.exit(1);
			}
			const run = (cmd, timeout) =>
				execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout }).trim();
			try {
				run(`git fetch origin ${base}`, 30_000);
			} catch {
				console.error(
					`[resolve-base-branch] WARN: git fetch origin ${base} 失敗 (offline?) — 手元 ref で鮮度判定します`,
				);
			}
			const behind = run(`git rev-list --count HEAD..origin/${base}`);
			if (behind !== '0') {
				console.error(
					`[resolve-base-branch] FAIL: HEAD は origin/${base} より ${behind} commits 遅れています (stale base 基点ズレ #2975)`,
				);
				console.error(`          対処: git fetch origin ${base} && git rebase origin/${base}`);
				process.exit(1);
			}
			console.error(
				`[resolve-base-branch] OK: HEAD は origin/${base} の最新を取り込み済 (behind 0)`,
			);
		}
		process.stdout.write(`${base}\n`);
		process.exit(0);
	} catch (err) {
		console.error(
			'[resolve-base-branch] ERROR: git 情報を取得できません (呼び出し側は main に fallback してください):',
			err instanceof Error ? err.message : err,
		);
		process.exit(1);
	}
}
