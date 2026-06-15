#!/usr/bin/env node
/**
 * scripts/hotfix-back-merge.mjs — Issue #2951 (Phase B/B-5、親 #2949 / EPIC #2861)
 *
 * develop 二層ブランチ戦略 (docs/sessions/branch-strategy.md §5「hotfix 経路」) における
 * 「main に merge された PR が hotfix で、main → develop back-merge を発行すべきか」を
 * 判定する **純粋関数 SSOT** (`.github/workflows/hotfix-back-merge.yml` の薄い orchestrator が
 * 本 script を呼ぶ。判定 logic は全て本 file に集約し yml に分散させない)。
 *
 * 背景:
 *   `branch-strategy.md` §5 は「hotfix を main に merge したら同じ修正を develop へ back-merge
 *   する (main / develop の drift 防止)」を **必須** と定めるが、現状 **人手運用で機械強制が無い**。
 *   hotfix は緊急対応で出されるため最も back-merge を忘れやすく、忘れると
 *   (1) develop に hotfix が欠落して次の統合 PR で同バグ再混入
 *   (2) develop → main 統合 PR で hotfix と conflict
 *   (3) main / develop が静かに drift して統合 PR が肥大化
 *   という git flow 典型の失敗が起きる。本 script + workflow がこれを機械強制する。
 *
 * `scripts/pr-lane.mjs` (#2943 A-1) との責務分担:
 *   - pr-lane.mjs = **PR event 基点** の lane 分類 (baseRef/headRef/actor → feature/integration/...)。
 *     back-merge PR (head=main, base=develop) を 'feature' 軽量レーンに分類する (rule 4)。
 *   - hotfix-back-merge.mjs (本 file) = **push[main] event 基点** の back-merge 要否判定。
 *     「今 main に merge された PR が hotfix か (= back-merge を発行すべきか)」を判定する。
 *   両者は入力源 (PR event vs merge commit / push event) と用途 (lane 分類 vs back-merge 起動) が
 *   異なるため統合しない。lane 値の凡例 (feature/integration/hotfix) は共有概念。
 *
 * 判定の核心 (3 つの純粋関数):
 *
 *   1. classifyMergedPr({ headRef, baseRef, labels })
 *      → 'hotfix' | 'integration' | 'other'
 *      main に merge された PR を分類する。
 *      - baseRef === 'main' かつ headRef === 'develop'           → 'integration' (統合 PR)
 *      - baseRef === 'main' かつ (headRef が 'fix/' で始まる       → 'hotfix'
 *           または labels に 'hotfix' / 'priority:critical')
 *      - 上記以外                                                  → 'other'
 *
 *   2. shouldBackMerge(classification)
 *      → boolean
 *      'hotfix' のみ true。'integration' は false (AC2: develop は同期済 = 無限ループ防止)。
 *      'other' も false (通常 push / 非 PR merge)。
 *
 *   3. backMergeBranchName(hotfixRef)
 *      → 'back-merge/<sanitized-hotfix-ref>'
 *      back-merge branch 名を決定的に生成 (同 hotfix の再実行で同名 = upsert 可能)。
 *
 *   no-op 判定 (AC5: 既に develop に同 commit があれば二重適用しない) は
 *   git の `git merge-base --is-ancestor <merge_sha> origin/develop` で workflow 側が行う
 *   (git 状態への副作用を伴うため本 pure script の責務外。本 file は「back-merge を起動すべき
 *   PR か」までを純粋判定し、git 実操作は workflow に委ねる = testability を保つ)。
 *
 * Usage (CLI、workflow から呼ぶ):
 *   node scripts/hotfix-back-merge.mjs --base main --head fix/999-x --labels "priority:critical,type:infra"
 *     → stdout に JSON: {"classification":"hotfix","shouldBackMerge":true,"branch":"back-merge/fix-999-x"}
 *   node scripts/hotfix-back-merge.mjs --base main --head develop
 *     → {"classification":"integration","shouldBackMerge":false,"branch":null}
 *
 * exit: 0 = 判定成功 (JSON を stdout 出力) / 2 = 引数不足
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** hotfix とみなす PR label (headRef が fix/* でなくてもこの label があれば hotfix 扱い)。 */
export const HOTFIX_LABELS = new Set(['hotfix', 'priority:critical']);

/**
 * main に merge された PR を分類する純粋関数 (unit test 対象、AC1/AC2)。副作用なし。
 *
 * @param {{
 *   headRef: string;        // merge された PR の head branch (例: 'fix/999-x' / 'develop' / 'feat/x')
 *   baseRef: string;        // merge された PR の base branch (常に 'main' 想定だが明示検証する)
 *   labels?: string[];      // PR label 名の配列 (例: ['priority:critical', 'type:infra'])
 * }} input
 * @returns {'hotfix' | 'integration' | 'other'}
 */
export function classifyMergedPr({ headRef, baseRef, labels = [] }) {
	const head = (headRef ?? '').trim();
	const base = (baseRef ?? '').trim();
	const labelSet = new Set((labels ?? []).map((l) => (l ?? '').trim()).filter(Boolean));

	// main 以外への merge は back-merge 対象外 (develop 向け feature PR 等)。
	if (base !== 'main') return 'other';

	// 統合 PR (develop → main): develop は既に同期済のため back-merge 不要 (AC2 無限ループ防止)。
	if (head === 'develop') return 'integration';

	// hotfix: fix/* branch、または hotfix / priority:critical label 付き。
	const hasHotfixLabel = [...labelSet].some((l) => HOTFIX_LABELS.has(l));
	if (head.startsWith('fix/') || hasHotfixLabel) return 'hotfix';

	// それ以外の main 向け merge (例: cutover 前の feat/* → main、CI 環境構築 PR 等) は
	// back-merge 対象外。§5 の例外 (CI 環境構築 main 直 PR) は develop 取込が必須でないため。
	return 'other';
}

/**
 * 分類結果から back-merge PR を発行すべきかを判定する純粋関数 (AC1/AC2)。
 *
 * @param {'hotfix' | 'integration' | 'other'} classification
 * @returns {boolean} 'hotfix' のみ true
 */
export function shouldBackMerge(classification) {
	return classification === 'hotfix';
}

/**
 * back-merge branch 名を決定的に生成する純粋関数。
 * 同じ hotfix ref からは常に同名を返す (workflow 再実行で同 branch を upsert 可能、AC5 補助)。
 * branch 名に使えない文字を '-' に正規化する。
 *
 * @param {string} hotfixRef  hotfix の head branch (例: 'fix/999-x') または merge SHA
 * @returns {string} 例: 'back-merge/fix-999-x'
 */
export function backMergeBranchName(hotfixRef) {
	const safe = (hotfixRef ?? '')
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '-') // git ref 不正文字を '-' に
		.replace(/^-+|-+$/g, '') // 前後の '-' を除去
		.replace(/-{2,}/g, '-'); // 連続 '-' を 1 つに
	return `back-merge/${safe || 'unknown'}`;
}

/**
 * workflow が消費する判定結果をまとめて返す facade (CLI 出力 SSOT)。
 *
 * @param {{ headRef: string; baseRef: string; labels?: string[] }} input
 * @returns {{ classification: 'hotfix'|'integration'|'other'; shouldBackMerge: boolean; branch: string|null }}
 */
export function evaluateBackMerge({ headRef, baseRef, labels = [] }) {
	const classification = classifyMergedPr({ headRef, baseRef, labels });
	const doBackMerge = shouldBackMerge(classification);
	return {
		classification,
		shouldBackMerge: doBackMerge,
		branch: doBackMerge ? backMergeBranchName(headRef) : null,
	};
}

/**
 * 簡易 argv パーサ (--base / --head / --labels)。判定 logic は持たない。
 * --labels はカンマ区切り文字列を配列に分解する。
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ baseRef: string; headRef: string; labels: string[] }}
 */
export function parseArgs(argv) {
	/** @type {Record<string, string>} */
	const out = { base: '', head: '', labels: '' };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === undefined || !arg.startsWith('--')) continue;
		const eq = arg.indexOf('=');
		if (eq !== -1) {
			out[arg.slice(2, eq)] = arg.slice(eq + 1);
		} else {
			out[arg.slice(2)] = argv[i + 1] ?? '';
			i += 1;
		}
	}
	return {
		baseRef: out.base ?? '',
		headRef: out.head ?? '',
		labels: (out.labels ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean),
	};
}

const isMain = (() => {
	try {
		return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	const { baseRef, headRef, labels } = parseArgs(process.argv.slice(2));
	if (!baseRef && !headRef) {
		console.error(
			'[hotfix-back-merge] Usage: node scripts/hotfix-back-merge.mjs --base <baseRef> --head <headRef> [--labels a,b]',
		);
		process.exit(2);
	}
	process.stdout.write(`${JSON.stringify(evaluateBackMerge({ headRef, baseRef, labels }))}\n`);
	process.exit(0);
}
