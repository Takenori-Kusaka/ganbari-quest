/**
 * どのコマンドを排他対象とみなすかの判定 SSOT (pure function)。
 *
 * hook 本体 (`.claude/hooks/heavy-run-lock.mjs`) から切り離してあるのは、
 * 判定だけを unit test で固定できるようにするためである。hook 本体は
 * 「stdin を読む / lock を取る / exit code を返す」に専念する。
 *
 * ## 何を重い検証とみなすか
 *
 * 数分以上マシンを占有し、並走すると**結果そのものが信用できなくなる**もの:
 * `pre-ready` / `vitest` / `playwright test` / `svelte-check` / `npm run test|check|e2e`。
 *
 * 並走の害は「遅くなる」ではない。2026-07-27 の実測では vitest の単独 17 分が並走で
 * 29 分に伸び、`Test timed out in 5000ms` が 5 件出た (assertion failure は 0 件)。
 * つまり**負荷が偽の red を作る**。この red を根拠に使うと誤診が下流へ伝播する。
 */

/** 重い検証の判定パターン。`(^|区切り)` を前置し、引数の一部への誤爆を避ける。 */
const HEAVY_PATTERNS = [
	/(^|[\s;&|(])(npm\s+run\s+)?pre-ready(\s|$)/,
	/(^|[\s;&|(])scripts[/\\]pre-ready\.mjs(\s|$)/,
	/(^|[\s;&|(])(npx\s+)?vitest(\s|$)/,
	/(^|[\s;&|(])(npx\s+)?playwright\s+test(\s|$)/,
	/(^|[\s;&|(])(npx\s+)?svelte-check(\s|$)/,
	/(^|[\s;&|(])npm\s+run\s+(test|check|e2e)(:[\w-]+)?(\s|$)/,
];

/**
 * 読み取り専用コマンド。これで始まる行は、引数に検証コマンド名が含まれていても
 * 実行ではないので対象外にする (`grep vitest ...` を block しないため)。
 */
const READ_ONLY_HEADS = new Set([
	'grep',
	'rg',
	'cat',
	'head',
	'tail',
	'less',
	'ls',
	'find',
	'echo',
	'type',
	'wc',
	'sed',
	'awk',
]);

/**
 * コマンド文字列の先頭トークンを返す (`node`, `npm`, `grep` 等)。
 *
 * @param {string} command
 * @returns {string}
 */
function headToken(command) {
	const trimmed = String(command ?? '').trimStart();
	const match = trimmed.match(/^([\w.\-/\\]+)/);
	// `String.split` は必ず 1 要素以上返すが TS はそれを知らないため既定値を置く。
	return match ? (match[1]?.split(/[/\\]/).pop() ?? '').toLowerCase() : '';
}

/**
 * 重い検証コマンドか。
 *
 * `&&` / `||` / `;` / `|` で区切った**セグメントごと**に判定する。コマンド全体の
 * 先頭トークンだけを見ると `echo start && npx vitest run` が「先頭は echo だから
 * 読み取り専用」と判定され、**前置きを 1 つ足すだけで排他を回避できてしまう**。
 * 判定を全体ではなくセグメント単位にすることで、この抜け道を塞ぐ。
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isHeavyCommand(command) {
	const text = String(command ?? '');
	if (text.trim() === '') return false;
	return text.split(/&&|\|\||;|\|/).some((segment) => {
		if (segment.trim() === '') return false;
		if (READ_ONLY_HEADS.has(headToken(segment))) return false;
		return HEAVY_PATTERNS.some((re) => re.test(segment));
	});
}

/**
 * コマンドから対象 PR 番号を拾う (block メッセージに載せるだけの補助情報)。
 *
 * @param {string} command
 * @returns {string | null}
 */
export function extractTarget(command) {
	const text = String(command ?? '');
	const pr = text.match(/--pr[=\s]+(\d+)/);
	if (pr) return `PR #${pr[1]}`;
	// Windows の `tests\unit\...` も拾えるよう区切りは両方許す。
	const spec = text.match(/(tests[/\\][^\s"']+)/);
	// capture group は match 成立時に必ず存在するが、TS の型は `string | undefined`。
	// 戻り値契約 (`string | null`) に合わせて明示的に落とす。
	if (spec) return spec[1] ?? null;
	return null;
}

/**
 * branch の成果を公開するコマンドか (`git push`)。
 *
 * ここを task lock の取得点にするのは、**同じ branch を 2 セッションが押す**のが
 * 二重作業の最も分かりやすい形であり、かつ誤爆しにくいからである。`gh pr merge` 等は
 * PR 番号で他人の PR を操作する role (QM / 監査) のコマンドで、自分の branch とは
 * 対応しないため対象にしない。
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isBranchPublishCommand(command) {
	const text = String(command ?? '');
	return text.split(/&&|\|\||;|\|/).some((segment) => {
		if (READ_ONLY_HEADS.has(headToken(segment))) return false;
		return /(^|[\s;&|(])git\s+(-C\s+\S+\s+)?push(\s|$)/.test(segment);
	});
}

/**
 * branch 名から Issue 番号を取り出し、task lock の key にする。
 *
 * 本リポジトリの branch 命名は `feat/3963-...` / `fix/4001-...` 等
 * (`docs/sessions/branch-strategy.md` §3)。同じ Issue に 2 セッションが着手すると
 * 同じ key になるため、二重着手が機械的に検出できる。
 *
 * @param {string} branch
 * @returns {string | null}
 */
export function taskKeyFromBranch(branch) {
	const match = String(branch ?? '').match(
		/^(?:feat|fix|refactor|design|infra|test|docs|marketing|eval)\/(\d+)[-/]/,
	);
	return match ? `task-${match[1]}` : null;
}

export default { isHeavyCommand, isBranchPublishCommand, extractTarget, taskKeyFromBranch };
