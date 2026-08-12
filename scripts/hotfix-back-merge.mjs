#!/usr/bin/env node
import { isMain as isMainModule } from './lib/is-main.mjs';

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

	// 統合 PR (release/* → main): **develop と同期済とは限らない**。
	// release cut 運用では cut 後に release branch 上だけで commit を積むことがあり
	// (第 21 回統合 #4304 で監査が #4311 を revert した例)、その差分は develop に無い。
	// head==='develop' と同じ 'integration' に落とすと back-merge が発行されず、
	// **release でしか消していない変更が develop に残り、次の cut で復活する**。
	// したがって back-merge 対象として扱う (#4304 adversarial obj-2)。
	if (head.startsWith('release/')) return 'hotfix';

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

const isMain = isMainModule(import.meta.url);

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
