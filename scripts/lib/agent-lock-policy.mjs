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

/**
 * **実行されないテキスト**を判定対象から外す (#4401)。
 *
 * 判定は「そのコマンドが重い検証を起動するか」でなければならないが、旧実装はコマンド文字列
 * 全体を 1 本の文字列として見ていたため、**重い検証を「言及する」だけの引数が block されていた**。
 * 実際に踏んだのは PR 本文を書く heredoc である。`.github/PULL_REQUEST_TEMPLATE.md` は
 * 「何をどう確かめたか。コマンドと結果」を要求しているので、**規約を守るほど詰まっていた**。
 *
 * 落とす対象は、シェルが**コマンドとして解釈しない**ことが構文から確定するものだけ:
 *
 * 1. heredoc の本文 (`<<'EOF' … EOF`) — 標準入力に流し込むデータであって実行されない
 * 2. テキストを運ぶ既知 flag の引用符付き引数 (`--body` / `-m` 等) — PR 本文 / commit message
 *
 * **引用符付き文字列を一律に落とすことはしない。** `sh -c "npx vitest run"` の中身は
 * 実行されるため、落とすと排他が回避できてしまう (検出力の低下 = gate の本来目的の毀損)。
 * 上の 2 つ以外は従来どおり全て判定対象に残す。
 */
const TEXT_CARRYING_FLAGS = /(--body|--message|--title|--notes|--description|-m)(=|\s+)/;

/**
 * @param {string} command
 * @returns {string}
 */
export function stripNonExecutableText(command) {
	let text = String(command ?? '');

	// 1) heredoc 本文。`<<EOF` / `<<'EOF'` / `<<-"EOF"` の delimiter 行までを落とす。
	text = text.replace(
		/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^[ \t]*\2[ \t]*$/gm,
		' [heredoc] ',
	);
	// 閉じ delimiter が見つからない (書きかけ / 途中で切れている) heredoc は、
	// 開始位置以降を丸ごと本文とみなす。**残すと本文が判定対象に戻る**ため。
	const unterminated = text.search(/<<-?\s*['"]?[A-Za-z_]/);
	if (unterminated >= 0) text = `${text.slice(0, unterminated)} [heredoc] `;

	// 2) テキストを運ぶ flag の引用符付き引数。
	text = text.replace(
		new RegExp(`${TEXT_CARRYING_FLAGS.source}(['"])[\\s\\S]*?\\3`, 'g'),
		'$1$2<text> ',
	);

	return text;
}

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
 * `&&` / `||` / `;` / `|` / 改行 で区切った**セグメントごと**に判定する。コマンド全体の
 * 先頭トークンだけを見ると `echo start && npx vitest run` が「先頭は echo だから
 * 読み取り専用」と判定され、**前置きを 1 つ足すだけで排他を回避できてしまう**。
 * 判定を全体ではなくセグメント単位にすることで、この抜け道を塞ぐ。
 *
 * 判定の前に {@link stripNonExecutableText} で**実行されないテキスト**を落とす (#4401)。
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isHeavyCommand(command) {
	return matchHeavyCommand(command).matched;
}

/**
 * 重い検証と判定した**根拠**まで返す (#4401)。
 *
 * block メッセージに「どの語に反応したか」を出すために使う。理由が出ないと、重い検証を
 * 起動していない Dev が「自分は回していないのに何故?」で止まる (本 Issue で実際に起きた)。
 *
 * @param {string} command
 * @returns {{ matched: boolean, trigger: string | null, segment: string | null }}
 *   `trigger` = 反応した語 (`npx vitest` 等)、`segment` = それを含むコマンドセグメント
 */
export function matchHeavyCommand(command) {
	const miss = { matched: false, trigger: null, segment: null };
	const text = stripNonExecutableText(command);
	if (text.trim() === '') return miss;

	for (const segment of text.split(/&&|\|\||;|\||\r?\n/)) {
		if (segment.trim() === '') continue;
		if (READ_ONLY_HEADS.has(headToken(segment))) continue;
		for (const re of HEAVY_PATTERNS) {
			const hit = segment.match(re);
			// 先頭の区切り文字 (`(^|[\s;&|(])`) を落として、反応した語だけを返す。
			if (hit) return { matched: true, trigger: hit[0].trim(), segment: segment.trim() };
		}
	}
	return miss;
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

export default { isHeavyCommand, matchHeavyCommand, stripNonExecutableText, extractTarget };
