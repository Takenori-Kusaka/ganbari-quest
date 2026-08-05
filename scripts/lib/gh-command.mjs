/**
 * scripts/lib/gh-command.mjs (#4027)
 *
 * `gh` CLI コマンド文字列を **サブコマンド + URL パス** の単位で解析する共有ロジック。
 *
 * # なぜ必要か
 * PreToolUse hook 2 本 — `scripts/claude-hook-prevent-qa-account-pr.mjs` (ADR-0022 L1) と
 * `.claude/hooks/gate-approve.mjs` (ADR-0056) — は同じ `gh` コマンド文字列を見て別々の判断を下す。
 * 両者が「文字列にこの語が含まれるか」で判定していた間、以下 2 つの誤検知が起きた (#4027):
 *
 *   1. account guard が `/pulls` の部分一致で **`/pulls/<n>/reviews` への POST (= QM の approve)** まで
 *      PR 作成として BLOCK した。`docs/sessions/qm-session.md` が SSOT として掲げる approve 経路が
 *      必ず止まる状態だった。
 *   2. gate-approve が `--body` / heredoc の**中身**に書かれた approve コマンド例に反応し、
 *      hook 自身を説明する Issue を起票する操作を approve 操作として BLOCK した。
 *
 * どちらも「実行される操作」ではなく「コマンド文字列に含まれる語」を見ていたことが原因。
 * 本モジュールは判定材料を次の 2 つに限定する:
 *   - サブコマンド (`gh pr create` / `gh pr merge` / `gh api` …)
 *   - 引数として渡された **API パス** (`repos/<owner>/<repo>/pulls` 等)
 * 引数の**値** (`--body` / `--body-file` / heredoc / `-f body=`) は判定に使わない。
 *
 * # 検出を弱めないための設計 (ADR-0006)
 * - 引用符は「囲み」ではなく単なる文字として捨てる。`bash -c "gh api repos/o/r/pulls -X POST"` の
 *   ように別 shell 経由で包んでも token 列に現れるため引き続き捕捉できる。
 * - パスは token 列の**どこに現れても**拾う (flag 順序非依存)。`-X POST -f title=x repos/o/r/pulls`
 *   のような後置でも検出する。
 * - パスは query / fragment / 末尾スラッシュ / `https://api.github.com` prefix を落としてから比較する。
 *   `repos/o/r/pulls?ref=/pulls/1/reviews` のように「subresource に見えるが実体はコレクション POST」の
 *   形も コレクション扱いで捕捉する。
 * - 引数**値**の中に別のパスが書かれていても、それはパス候補にしない (`-f title=/pulls/1/reviews` は
 *   `title=` 始まりなので候補 regex に一致しない)。
 */

/**
 * PowerShell 経路で現れる表記ゆれを吸収する (#4001)。
 *
 * 吸収する差分 (Windows agent が自然に書く形):
 *   - 呼び出し演算子 + 引用符付き exe: `& 'gh' pr merge 1` / `& "gh.exe" pr merge 1`
 *   - backtick 行継続: "gh pr `\n merge 1"
 *   - 連続空白 / タブ
 *
 * 変換は「検出側を広げる」方向にのみ効く (正規化しても既存 Bash 表記の判定は変わらない)。
 *
 * @param {string} command
 * @returns {string}
 */
export function normalizeCommand(command) {
	return command
		.replace(/`\r?\n/g, ' ') // PowerShell 行継続
		.replace(/&\s*(['"])([^'"]+)\1/g, '$2') // & 'gh' → gh
		.replace(/(['"])(gh(?:\.exe)?)\1/gi, '$2') // 'gh' → gh
		.replace(/[ \t]+/g, ' ');
}

/**
 * 判定に使ってはいけない「引数の値」を除去する (#4027 対応 3)。
 *
 * 対象:
 *   - heredoc の本文 (`<<'EOF' … EOF`) — PR / Issue / review body をそのまま埋め込む定番形
 *   - `--body` / `--body-file` / `-b` の値
 *   - `-f body=` / `--field body=` / `--raw-field body=` の値
 *
 * これらは「何を書いたか」であって「何を実行したか」ではない。hook 自身を説明する文書を
 * 書く操作が hook に捕捉される事故 (#4027 併発事例) を構造的に潰す。
 *
 * @param {string} command
 * @returns {string}
 */
export function stripArgumentBodies(command) {
	let s = String(command ?? '');
	// heredoc 本文 (delimiter 行までを丸ごと落とす)
	s = s.replace(
		/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2\b/g,
		'<<REDACTED_HEREDOC',
	);
	// --body-file / --body / -b の値 (--body-file を先に評価する必要があるため alternation 順に注意)
	s = s.replace(
		/(--body-file|--body|-b)(?:=|\s+)('[^']*'|"[^"]*"|\S+)/g,
		'$1 <REDACTED_ARG_VALUE>',
	);
	// -f body=… / --field body=… / --raw-field body=…
	s = s.replace(
		/(-f|-F|--field|--raw-field)(?:=|\s+)body=('[^']*'|"[^"]*"|\S+)/g,
		'$1 body=<REDACTED_ARG_VALUE>',
	);
	return s;
}

/**
 * 判定用の正規化済み文字列を返す (normalize + 引数値除去)。
 *
 * @param {string} command
 * @returns {string}
 */
export function sanitizeForDetection(command) {
	return normalizeCommand(stripArgumentBodies(command));
}

const SEGMENT_BREAKERS = new Set([';', '\n', '\r']);

/**
 * コマンド文字列を「1 コマンド相当」の segment に分割する (引用符を尊重)。
 *
 * `;` / 改行 / `&&` / `||` / `|` で区切る。`--jq '.a | .b'` のように引用符内にある区切り文字は
 * 区切りとして扱わない。
 *
 * @param {string} command
 * @returns {string[]}
 */
export function splitCommandSegments(command) {
	const segments = [];
	let cur = '';
	let quote = null;
	for (let i = 0; i < command.length; i += 1) {
		// charAt は範囲外でも '' を返すため、index アクセスと違い undefined を持ち込まない
		const ch = command.charAt(i);
		if (quote) {
			cur += ch;
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			cur += ch;
			continue;
		}
		if (SEGMENT_BREAKERS.has(ch)) {
			segments.push(cur);
			cur = '';
			continue;
		}
		if (
			(ch === '&' && command.charAt(i + 1) === '&') ||
			(ch === '|' && command.charAt(i + 1) === '|')
		) {
			segments.push(cur);
			cur = '';
			i += 1;
			continue;
		}
		if (ch === '|') {
			segments.push(cur);
			cur = '';
			continue;
		}
		cur += ch;
	}
	segments.push(cur);
	return segments.filter((s) => s.trim() !== '');
}

/**
 * segment を token 列にする。
 *
 * 引用符は「囲み」ではなく捨てる文字として扱う (`bash -c "gh api …"` のような入れ子経由でも
 * token 列に gh が現れるようにするため。ADR-0006 — 検出を弱めない)。
 * 先頭の `$(` / `(` / backtick、末尾の `)` / backtick は削って比較する。
 *
 * @param {string} segment
 * @returns {string[]}
 */
export function tokenizeSegment(segment) {
	return segment
		.replace(/['"]/g, ' ')
		.split(/\s+/)
		.map((t) => t.replace(/^[`$(]+/, '').replace(/[`)]+$/, ''))
		.filter((t) => t !== '');
}

/**
 * `gh` 呼び出しを列挙する。1 segment 内に複数あっても全て返す。
 *
 * @param {string} command  sanitizeForDetection 済み文字列を渡すこと
 * @returns {{ segment: string; argv: string[] }[]}
 */
export function findGhInvocations(command) {
	const invocations = [];
	for (const segment of splitCommandSegments(command)) {
		const tokens = tokenizeSegment(segment);
		for (const [i, token] of tokens.entries()) {
			if (/^gh(?:\.exe)?$/i.test(token)) {
				invocations.push({ segment: segment.trim(), argv: tokens.slice(i + 1) });
			}
		}
	}
	return invocations;
}

/** 値を伴う `gh api` の flag。次の token を値として消費する。 */
const VALUE_FLAGS = new Set([
	'-X',
	'--method',
	'-f',
	'--field',
	'-F',
	'--raw-field',
	'-H',
	'--header',
	'-q',
	'--jq',
	'-t',
	'--template',
	'--input',
	'--hostname',
	'--cache',
	'-p',
	'--preview',
]);

/** 値を伴う flag のうち「POST を暗黙に指定する」もの (gh api の既定挙動)。 */
const IMPLIES_POST = new Set(['-f', '--field', '-F', '--raw-field', '--input']);

/** `repos/<owner>/<repo>/pulls…` の形をした token だけをパス候補にする。 */
const PULLS_PATH_RE =
	/^(?:https?:\/\/api\.github\.com)?\/?repos\/[^/\s]+\/[^/\s]+\/pulls(?:[/?#][^\s]*)?$/i;

/**
 * API パス token を比較用に正規化する (prefix / query / fragment / 末尾スラッシュを落とす)。
 *
 * @param {string} token
 * @returns {string}
 */
export function normalizeApiPath(token) {
	return token
		.replace(/^https?:\/\/api\.github\.com/i, '')
		.replace(/[?#].*$/, '')
		.replace(/^\/+/, '')
		.replace(/\/+$/, '');
}

/**
 * `gh api` 呼び出しの argv を解析する。
 *
 * @param {string[]} argv  `gh` の次の token から始まる配列 (先頭が 'api' のときのみ意味を持つ)
 * @returns {{ isApi: boolean; method: string; paths: string[] }}
 */
export function parseGhApiInvocation(argv) {
	if (!Array.isArray(argv) || argv.at(0) !== 'api') {
		return { isApi: false, method: 'GET', paths: [] };
	}
	/** @type {string|null} */
	let explicitMethod = null;
	let impliesPost = false;
	// 値を伴う flag なのに値が無い = 解析できなかったケース。allow 側ではなく POST (= BLOCK 側) に倒す。
	let unresolvedValue = false;
	/** @type {string[]} */
	const paths = [];
	let index = 1;
	while (index < argv.length) {
		const token = argv.at(index);
		index += 1;
		if (token === undefined) {
			// 配列長と要素の整合が崩れている = 解析不能。fail-closed (#3999 と同じ穴を開けない)。
			unresolvedValue = true;
			break;
		}
		if (token.startsWith('-')) {
			const eq = token.indexOf('=');
			const flagName = eq > 0 ? token.slice(0, eq) : token;
			const inlineValue = eq > 0 ? token.slice(eq + 1) : null;
			if (!VALUE_FLAGS.has(flagName)) continue;
			let value = inlineValue;
			if (value === null) {
				value = argv.at(index) ?? null;
				index += 1;
			}
			if (flagName === '-X' || flagName === '--method') {
				if (value === null) unresolvedValue = true;
				else explicitMethod = value.toUpperCase();
			} else if (IMPLIES_POST.has(flagName)) {
				impliesPost = true;
			}
			continue;
		}
		if (PULLS_PATH_RE.test(token) || /^\/?graphql$/i.test(token)) {
			paths.push(normalizeApiPath(token));
		}
	}
	const method = explicitMethod ?? (impliesPost || unresolvedValue ? 'POST' : 'GET');
	return { isApi: true, method, paths };
}

/**
 * `repos/<owner>/<repo>/pulls` (コレクション) か。
 *
 * @param {string} path  normalizeApiPath 済みのパス
 * @returns {boolean}
 */
export function isPullsCollectionPath(path) {
	return /^repos\/[^/]+\/[^/]+\/pulls$/i.test(path);
}

/**
 * `repos/<owner>/<repo>/pulls/<n>/<subresource>` か。
 *
 * @param {string} path  normalizeApiPath 済みのパス
 * @param {string} subresource  `reviews` / `merge` 等 (正規表現に埋め込むため呼出側で定数を渡すこと)
 * @returns {boolean}
 */
export function isPullsSubresourcePath(path, subresource) {
	return new RegExp(`^repos/[^/]+/[^/]+/pulls/\\d+/${subresource}(?:/.*)?$`, 'i').test(path);
}

/**
 * `repos/<owner>/<repo>/pulls/<何か>/<subresource>` か — **PR 識別子の形を問わない** (#4057)。
 *
 * `isPullsSubresourcePath` は PR 番号を `\d+` に固定していたため、`.../pulls/$n/reviews` の
 * ようにループ変数で書くだけで approve 検出をすり抜けた (QM 実測。同時刻にリテラル形は
 * 正しく BLOCK されており、**番号の書き方だけで gate の有無が変わっていた**)。
 *
 * approve 行為か否かは「PR 番号がリテラルで書かれているか」とは無関係なので、判定は
 * subresource だけで行い、番号の確定は別工程 (取れなければ block) に分ける。
 *
 * @param {string} path  normalizeApiPath 済みのパス
 * @param {string} subresource  `reviews` / `merge` 等
 * @returns {boolean}
 */
export function isPullsSubresourcePathAnyRef(path, subresource) {
	return new RegExp(`^repos/[^/]+/[^/]+/pulls/[^/]+/${subresource}(?:/.*)?$`, 'i').test(path);
}

/**
 * `repos/<owner>/<repo>/pulls/<何か>…` — 特定 PR (またはその subresource) を指すパスか。
 *
 * コレクション (`…/pulls`) は含まない。PR 作成 (コレクション POST) は ADR-0022 L1 の責務で、
 * 本判定の対象ではないため。
 *
 * @param {string} path  normalizeApiPath 済みのパス
 * @returns {boolean}
 */
export function isPullsScopedPath(path) {
	return /^repos\/[^/]+\/[^/]+\/pulls\/.+$/i.test(path);
}

/**
 * token に **未展開のシェル展開**が残っているか (#4057)。
 *
 * `$(cmd)` / `` `cmd` `` / `$VAR` / `${VAR}` / `%VAR%` (cmd.exe)。これらを含むパスは
 * hook 側から見て**実際に叩かれる URL を確定できない**。確定できないものを「approve ではない」
 * 側に倒すと、書き方を変えるだけで gate を抜けられる (#4057 の実測形がまさにこれ)。
 *
 * @param {string} token
 * @returns {boolean}
 */
export function hasUnresolvedExpansion(token) {
	return /\$\(|\$\{|\$[A-Za-z_]|`|%[A-Za-z_][A-Za-z0-9_]*%/.test(String(token ?? ''));
}
