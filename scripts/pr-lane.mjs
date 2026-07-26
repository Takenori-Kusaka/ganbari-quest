#!/usr/bin/env node
import { isMain as isMainModule } from './lib/is-main.mjs';

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
	// 2. develop → main または release/* → main = 統合 PR (重量レーン)
	//    release/* は develop の凍結コミットから cut した統合標的 (branch-strategy.md §3)。
	if (base === 'main' && (head === 'develop' || head.startsWith('release/'))) return 'integration';
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

const isMain = isMainModule(import.meta.url);

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
