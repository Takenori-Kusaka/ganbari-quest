#!/usr/bin/env node
/**
 * scripts/pr-lane.mjs — Issue #2943 (Phase A/A-1、親 #2942 / EPIC #2861)
 *
 * develop 二層ブランチ戦略 (docs/sessions/branch-strategy.md §3〜§5) における
 * 「この PR がどのレーンか」を判定する **CI 側 (サーバ gate 用) の正準ロジック (SSOT)**。
 *
 * 背景:
 *   現状、PR の種別判定は (1) Dependabot exempt = `github.actor != 'dependabot[bot]'` の
 *   文字列が 6+ workflow に inline 重複、(2) main/develop/hotfix の base/head 判定 =
 *   `ci.yml` の `main-pr-base-guard` に bash で 1 箇所だけ、と散在している。
 *   lane-aware 化 (A-2〜A-5) を進めると同じ判定を 6 workflow にコピペすることになり、
 *   判定基準のドリフトが構造的に発生する。本 script はその判定を 1 つの純粋関数に集約し、
 *   composite action (actions/pr-lane) 経由で全 gate が同一 SSOT を参照する
 *   (terms.ts / ADR-0042 の 3 層トークンと同型の SSOT 思想)。
 *
 * `scripts/lib/resolve-base-branch.mjs` (#2959) との責務分担:
 *   - resolve-base-branch.mjs = **クライアント tooling 用** (local git 基点)。
 *     「現在の branch がどの base に push / PR すべきか」を local git / gh から解決する。
 *     副作用あり (execSync で git / gh を叩く)。
 *   - pr-lane.mjs (本 file) = **CI gate 用** (PR event payload 基点)。
 *     既に確定した PR の baseRef / headRef / actor から lane を分類する純粋関数。
 *     副作用ゼロ (GitHub API / file write を一切行わない、AC6)。
 *   両者は入力源 (local git 推定 vs PR event payload の確定値) と用途が異なるため統合せず、
 *   概念整合を本コメントで相互参照する (#2943 related / #2959 follow-up 評価結果)。
 *   統合しない判断: pr-lane は base/head/actor を「確定値」として受け取る pure function で
 *   ある一方、resolve-base-branch は local git を推定走査する副作用関数であり、
 *   片方を他方の入力にすると pure function の testability (AC6) が崩れるため。
 *
 * lane 分類 (4 種、決定的・優先順位付き = 最初にマッチした lane を返す):
 *   1. actor が `dependabot[bot]` / `renovate[bot]`       → 'dependabot'
 *   2. headRef === 'develop' かつ baseRef === 'main'      → 'integration' (統合 PR、重量レーン)
 *   3. headRef が 'fix/' で始まり baseRef === 'main'      → 'hotfix'      (ADR-0002 重量レーン)
 *   4. baseRef === 'develop'                              → 'feature'    (軽量レーン)
 *   5. 上記いずれにも非該当                                → 'feature'    (既定、後方互換)
 *
 * back-merge PR の帰属 (#2960 / #2967 実地観測):
 *   hotfix を main に merge した後の main → develop back-merge PR
 *   (head=main、base=develop、branch-strategy.md §3「ホットフィックス経路」)は
 *   rule 4 (baseRef === 'develop') で **'feature' (軽量レーン)** に分類される。
 *   develop に取り込む変更は軽量レーン gate で十分であり、5 つ目の lane を新設しない
 *   (no-go: 「lane を 4 種から増やさない」ADR-0010 Pre-PMF)。rule 2 の integration は
 *   head=develop & base=main の逆向きなので back-merge とは衝突しない。
 *
 * Usage (CLI、AC5):
 *   node scripts/pr-lane.mjs --base main --head develop --actor x   # => "integration"
 *   node scripts/pr-lane.mjs --base develop --head feat/123 --actor Takenori-Kusaka  # => "feature"
 *
 * exit: 0 = 分類成功 (lane を stdout に出力) / 2 = 引数不足
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `dependabot` lane に分類される bot actor の集合 (SSOT、#2947 AC1)。
 *
 * 「bot とは誰か」をこの 1 箇所だけで定義する。auto-merge (dependabot-auto-merge.yml) や
 * gate workflow の exempt (`github.actor != 'dependabot[bot]'` 等の inline 重複) は、
 * この集合 / `classifyLane` の `dependabot` lane 判定を SSOT として参照し、判定基準の
 * 二重実装を解消する。新 bot (別の自動更新 bot 等) を追加する際は本配列を 1 行修正する
 * だけで全 gate の bot 扱いに伝播する (terms.ts atom / ADR-0042 3 層トークンと同型の SSOT)。
 *
 * 注: `dependabot-auto-merge.yml` の auto-merge 発火条件は **dependabot[bot] のみ** で
 * renovate を含まない (現行仕様、#2947 no-go「auto-merge を renovate に拡大しない」)。
 * 本集合は「lane = dependabot として exempt / 軽量扱いする actor」の定義であり、
 * 「auto-merge 対象 actor」とは別概念。両者を混同しないこと。
 *
 * @type {readonly string[]}
 */
export const BOT_ACTORS = Object.freeze(['dependabot[bot]', 'renovate[bot]']);

const BOT_ACTOR_SET = new Set(BOT_ACTORS);

/**
 * PR lane 判定の純粋関数 (unit test 対象、AC1)。副作用なし (AC6)。
 *
 * @param {{
 *   baseRef: string;   // PR の base branch 名 (例: 'main' / 'develop')。GitHub Actions では `github.base_ref`
 *   headRef: string;   // PR の head branch 名 (例: 'develop' / 'feat/123-x' / 'fix/999')。`github.head_ref`
 *   actor: string;     // PR を作成した actor (例: 'Takenori-Kusaka' / 'dependabot[bot]')。`github.actor`
 * }} input
 * @returns {'feature' | 'integration' | 'hotfix' | 'dependabot'}
 */
export function classifyLane({ baseRef, headRef, actor }) {
	const base = (baseRef ?? '').trim();
	const head = (headRef ?? '').trim();
	const who = (actor ?? '').trim();

	// 1. bot は base/head より優先 (Dependabot exempt を lane の 1 種として吸収、BOT_ACTORS SSOT)
	if (BOT_ACTOR_SET.has(who)) return 'dependabot';
	// 2. develop → main = 統合 PR (重量レーン)
	if (head === 'develop' && base === 'main') return 'integration';
	// 3. fix/* → main = hotfix (ADR-0002 重量レーン)
	if (head.startsWith('fix/') && base === 'main') return 'hotfix';
	// 4. → develop = 軽量レーン (back-merge main→develop もここに帰属)
	if (base === 'develop') return 'feature';
	// 5. 既定: cutover 前の main 向け通常 PR も軽量観点で扱う (後方互換)
	return 'feature';
}

/**
 * 簡易 argv パーサ (--base / --head / --actor)。pure 関数ではないが
 * classifyLane の入力収集に限定し、判定 logic は持たない。
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ baseRef: string; headRef: string; actor: string }}
 */
export function parseArgs(argv) {
	/** @type {Record<string, string>} */
	const out = { base: '', head: '', actor: '' };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === undefined || !arg.startsWith('--')) continue;
		const eq = arg.indexOf('=');
		if (eq !== -1) {
			// --base=main 形式
			out[arg.slice(2, eq)] = arg.slice(eq + 1);
		} else {
			// --base main 形式
			out[arg.slice(2)] = argv[i + 1] ?? '';
			i += 1;
		}
	}
	return { baseRef: out.base ?? '', headRef: out.head ?? '', actor: out.actor ?? '' };
}

const isMain = (() => {
	try {
		return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	const { baseRef, headRef, actor } = parseArgs(process.argv.slice(2));
	if (!baseRef && !headRef && !actor) {
		console.error(
			'[pr-lane] Usage: node scripts/pr-lane.mjs --base <baseRef> --head <headRef> --actor <actor>',
		);
		process.exit(2);
	}
	process.stdout.write(`${classifyLane({ baseRef, headRef, actor })}\n`);
	process.exit(0);
}
