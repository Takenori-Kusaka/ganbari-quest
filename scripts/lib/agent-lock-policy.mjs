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
 *
 * ## 判定は文字列の部分一致ではなく構造で行う (#4071 / #4076)
 *
 * 「コマンドを**実行する**」と「コマンド名に**言及する**」は別物である。部分一致で
 * 判定すると、`gh issue create --title "… pre-ready …"` のように重い検証を 1 つも
 * 起動しないコマンドまで止まる (実測 3 件)。同様に、判定の入力に実行文脈 (hook の cwd)
 * を使うと worktree からの push がメインクローンの branch で判定される (実測)。
 *
 * したがって本 module は **(a) 実行される先頭コマンド + サブコマンドの構造**と
 * **(b) push refspec / コマンドの cwd** という「対象そのもの」だけを見る。
 */

import { resolve } from 'node:path';

/**
 * `npm run <script>` で重い検証になるスクリプト名。
 * `test:unit` / `check:types` のようなサフィックス付きも同じ扱いにする。
 */
const HEAVY_NPM_SCRIPTS = /^(pre-ready|test|check|e2e)(:[\w-]+)?$/;

/** 実行ファイル名だけで重いと判る bin。 */
const HEAVY_BINS = new Set(['vitest', 'svelte-check', 'pre-ready']);

/** パッケージランナー。次の非フラグトークンが実行される bin になる。 */
const PACKAGE_RUNNERS = new Set(['npx', 'dlx', 'exec']);

/** パッケージマネージャ。`run <script>` の形を解釈する。 */
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/** 前置きの実行ラッパ。読み飛ばして「実際に実行される先頭コマンド」まで進む。 */
const EXEC_WRAPPERS = new Set(['env', 'nohup', 'time', 'cross-env', 'dotenv', 'command']);

/** シェル。`-c "..."` の中身を**再帰的に**判定する (回避経路を残さないため)。 */
const SHELLS = new Set(['bash', 'sh', 'dash', 'zsh', 'pwsh', 'powershell', 'cmd']);

/** シェルに続く「次の引数がスクリプト本文」を意味するフラグ。 */
const SHELL_SCRIPT_FLAGS = new Set(['-c', '-command', '/c', '/k', '-noprofile', '-noninteractive']);

/**
 * 1 セグメントをトークン列にする。クォートは**中身を 1 トークンにまとめ、
 * 引用されていた事実を保持する**。
 *
 * 引用の有無を残すのは、`gh issue create --title "npm run pre-ready ..."` の
 * ような「コマンド名に言及しているだけ」の引数を、実行と区別するためである (#4071)。
 *
 * @param {string} segment
 * @returns {{text: string, quoted: boolean}[]}
 */
function tokenize(segment) {
	/** @type {{text: string, quoted: boolean}[]} */
	const tokens = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let m = re.exec(segment);
	while (m !== null) {
		if (m[1] !== undefined) tokens.push({ text: m[1], quoted: true });
		else if (m[2] !== undefined) tokens.push({ text: m[2], quoted: true });
		else tokens.push({ text: m[3] ?? '', quoted: false });
		m = re.exec(segment);
	}
	return tokens;
}

/**
 * 実行ファイル名を正規化する (パス / 拡張子を落として小文字化)。
 *
 * @param {string} token
 * @returns {string}
 */
function binName(token) {
	const last =
		String(token ?? '')
			.split(/[/\\]/)
			.pop() ?? '';
	return last.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/**
 * `i` 以降で最初の「フラグでない非引用トークン」の位置を返す。無ければ -1。
 *
 * 引用トークンを飛ばすのではなく**そこで打ち切る** — 引用された文字列は
 * 実行対象ではなくデータであり、その先を command position として読むと
 * 引数の中身で判定してしまう。
 *
 * @param {{text: string, quoted: boolean}[]} tokens
 * @param {number} from
 * @returns {number}
 */
function nextWordIndex(tokens, from) {
	for (let i = from; i < tokens.length; i++) {
		const t = tokens[i];
		if (!t || t.quoted) return -1;
		if (t.text.startsWith('-') || t.text.startsWith('/')) continue;
		return i;
	}
	return -1;
}

/**
 * `bin` (+ 続くサブコマンド) が重い検証か。
 *
 * @param {string} bin
 * @param {string | null} next
 * @returns {boolean}
 */
function isHeavyBin(bin, next) {
	const name = binName(bin);
	if (name === 'pre-ready.mjs' || /^pre-ready\.(m?js|cjs)$/.test(name)) return true;
	if (HEAVY_BINS.has(name)) return true;
	if (name === 'playwright') return binName(next ?? '') === 'test';
	return false;
}

/**
 * トークン列 (1 セグメント) が重い検証を**実行する**か。
 *
 * 判定は「実行される先頭コマンド + そのサブコマンド」という**構造上の位置**だけを見る。
 * 引数・パス・引用符の中に検証コマンド名が出てきても実行ではないので反応しない (#4071)。
 *
 * @param {{text: string, quoted: boolean}[]} tokens
 * @param {number} depth シェル再帰の深さ (暴走防止)
 * @returns {boolean}
 */
function isHeavyTokens(tokens, depth) {
	if (depth > 3) return false;
	let i = 0;
	// 環境変数の前置き (`CI=1 npx vitest`) と実行ラッパ (`env` / `nohup` …) を読み飛ばす。
	while (i < tokens.length) {
		const t = tokens[i];
		if (!t || t.quoted) return false;
		if (/^[A-Za-z_][\w]*=/.test(t.text)) {
			i++;
			continue;
		}
		if (EXEC_WRAPPERS.has(binName(t.text))) {
			i++;
			continue;
		}
		break;
	}
	const headTok = tokens[i];
	if (!headTok || headTok.quoted) return false;
	const head = binName(headTok.text);

	// シェル経由 (`bash -c "npx vitest run"`) は中身を再帰判定する。ここを見ないと
	// 引用で包むだけで排他を回避できてしまう。
	if (SHELLS.has(head)) {
		for (let j = i + 1; j < tokens.length; j++) {
			const t = tokens[j];
			if (!t) break;
			if (!t.quoted && SHELL_SCRIPT_FLAGS.has(t.text.toLowerCase())) continue;
			if (isHeavyCommand(t.text, depth + 1)) return true;
		}
		return false;
	}

	if (PACKAGE_MANAGERS.has(head)) {
		const subIdx = nextWordIndex(tokens, i + 1);
		if (subIdx === -1) return false;
		const sub = tokens[subIdx]?.text ?? '';
		// `npm run <script>` / `pnpm run <script>`
		if (sub === 'run' || sub === 'run-script') {
			const scriptIdx = nextWordIndex(tokens, subIdx + 1);
			if (scriptIdx === -1) return false;
			return HEAVY_NPM_SCRIPTS.test(tokens[scriptIdx]?.text ?? '');
		}
		// `npm exec vitest` / `pnpm dlx vitest`
		if (PACKAGE_RUNNERS.has(sub)) {
			const binIdx = nextWordIndex(tokens, subIdx + 1);
			if (binIdx === -1) return false;
			return isHeavyBin(tokens[binIdx]?.text ?? '', tokens[binIdx + 1]?.text ?? null);
		}
		// `npm test` (run 省略形)
		return HEAVY_NPM_SCRIPTS.test(sub);
	}

	if (PACKAGE_RUNNERS.has(head)) {
		const binIdx = nextWordIndex(tokens, i + 1);
		if (binIdx === -1) return false;
		return isHeavyBin(tokens[binIdx]?.text ?? '', tokens[binIdx + 1]?.text ?? null);
	}

	if (head === 'node') {
		const scriptIdx = nextWordIndex(tokens, i + 1);
		if (scriptIdx === -1) return false;
		return isHeavyBin(tokens[scriptIdx]?.text ?? '', tokens[scriptIdx + 1]?.text ?? null);
	}

	return isHeavyBin(headTok.text, tokens[i + 1]?.text ?? null);
}

/**
 * 重い検証コマンドか。
 *
 * `&&` / `||` / `;` / `|` で区切った**セグメントごと**に判定する。全体の先頭だけを見ると
 * `echo start && npx vitest run` を読み取り専用と誤判定し、**前置きを 1 つ足すだけで
 * 排他を回避できてしまう**ためである。
 *
 * セグメント内は**文字列の部分一致では判定しない**。「コマンドを実行する」と
 * 「コマンド名に言及する」を区別できず、`gh issue create --title "... pre-ready ..."`
 * のように検証を 1 つも起動しないコマンドまで止めてしまう (#4071 実測 3 件)。
 *
 * @param {string} command
 * @param {number} [depth] 内部用 (シェル再帰)
 * @returns {boolean}
 */
export function isHeavyCommand(command, depth = 0) {
	const text = String(command ?? '');
	if (text.trim() === '') return false;
	return splitSegments(text).some((segment) => {
		if (segment.trim() === '') return false;
		return isHeavyTokens(tokenize(segment), depth);
	});
}

/**
 * コマンドを実行セグメントに割る。**引用符の中では区切らない。**
 *
 * 単純な `split(/&&|;|\|/)` だと `gh issue create --title "止める; npx vitest run"` の
 * 引用符内が独立セグメントに化け、実行していないコマンドを実行と読んでしまう。
 *
 * @param {string} command
 * @returns {string[]}
 */
function splitSegments(command) {
	const text = String(command ?? '');
	/** @type {string[]} */
	const segments = [];
	let buf = '';
	/** @type {string | null} */
	let quote = null;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			buf += ch;
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			buf += ch;
			continue;
		}
		if (ch === ';' || ch === '|' || ch === '&') {
			// `&&` / `||` は 2 文字。1 文字ずつ捨てても区切りとしては等価。
			segments.push(buf);
			buf = '';
			continue;
		}
		buf += ch;
	}
	segments.push(buf);
	return segments;
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
	return splitSegments(command).some((segment) => pushTokens(segment) !== null);
}

/**
 * セグメントが `git push` なら、`push` 以降のトークン列を返す。違えば null。
 *
 * 先頭が `git` であることを要求する — `grep -rn "git push" docs/` のように
 * 引数に文字列として出てくるだけのものを push と読まないため。
 *
 * @param {string} segment
 * @returns {{tokens: {text: string, quoted: boolean}[], pushIndex: number, dashCDir: string | null} | null}
 */
function pushTokens(segment) {
	const tokens = tokenize(segment);
	let i = 0;
	while (i < tokens.length) {
		const t = tokens[i];
		if (!t || t.quoted) return null;
		if (/^[A-Za-z_][\w]*=/.test(t.text) || EXEC_WRAPPERS.has(binName(t.text))) {
			i++;
			continue;
		}
		break;
	}
	const head = tokens[i];
	if (!head || head.quoted || binName(head.text) !== 'git') return null;

	/** @type {string | null} */
	let dashCDir = null;
	let j = i + 1;
	while (j < tokens.length) {
		const t = tokens[j];
		if (!t || t.quoted) return null;
		if (t.text === '-C') {
			dashCDir = tokens[j + 1]?.text ?? null;
			j += 2;
			continue;
		}
		if (t.text.startsWith('-')) {
			j++;
			continue;
		}
		break;
	}
	if (tokens[j]?.text !== 'push') return null;
	return { tokens, pushIndex: j, dashCDir };
}

/**
 * push の refspec から**押そうとしている branch 名**を取り出す。
 *
 * これが #4076 の核である。以前はコマンドを見ず、hook プロセスの cwd
 * (= メインクローン) で `git rev-parse HEAD` して判定していたため、worktree から
 * `git push origin fix/3980-...` しても**メインクローンの `fix/4017-...`** で
 * 二重作業判定され、無関係な BLOCK が出ていた。
 *
 * 取れない形 (`git push` 単独 / `-u origin HEAD`) では `null` を返し、
 * 呼び出し側が `resolveCommandCwd` 起点の HEAD 解決にフォールバックする。
 *
 * @param {string} command
 * @returns {string | null}
 */
export function resolvePushRefBranch(command) {
	for (const segment of splitSegments(command)) {
		const parsed = pushTokens(segment);
		if (!parsed) continue;
		/** @type {string[]} */
		const operands = [];
		for (let k = parsed.pushIndex + 1; k < parsed.tokens.length; k++) {
			const t = parsed.tokens[k];
			if (!t || t.quoted) break;
			if (t.text.startsWith('-')) continue;
			operands.push(t.text);
		}
		// operands = [remote, refspec?]。refspec が無い形 (`git push` / `git push origin`) は null。
		const refspec = operands[1];
		if (!refspec) continue;
		// `+src:dst` / `HEAD:refs/heads/foo` → dst 側を採る。
		const dst = refspec.replace(/^\+/, '').split(':').pop() ?? '';
		const branch = dst.replace(/^refs\/heads\//, '');
		if (branch === '' || branch === 'HEAD') continue;
		return branch;
	}
	return null;
}

/**
 * コマンドが**実際に実行される作業ディレクトリ**を解決する (#4076)。
 *
 * hook payload の `cwd` はセッションの作業ディレクトリであり、`cd <worktree> && …` や
 * `git -C <worktree> …` で別 checkout を触っている場合とは一致しない。判定の入力は
 * 実行文脈ではなく**対象そのもの**にする。
 *
 * @param {string} command
 * @param {string | null} fallbackCwd
 * @returns {string | null}
 */
export function resolveCommandCwd(command, fallbackCwd) {
	let cwd = fallbackCwd ?? null;
	for (const segment of splitSegments(command)) {
		const parsed = pushTokens(segment);
		if (parsed?.dashCDir) return resolvePath(cwd, parsed.dashCDir);
		const tokens = tokenize(segment);
		const head = tokens[0];
		if (!head || head.quoted || binName(head.text) !== 'cd') continue;
		const dir = tokens[1];
		if (!dir || dir.text.startsWith('-')) continue;
		cwd = resolvePath(cwd, dir.text);
	}
	return cwd;
}

/**
 * 相対パスを基準ディレクトリで解決する。
 *
 * @param {string | null} base
 * @param {string} dir
 * @returns {string}
 */
function resolvePath(base, dir) {
	return base ? resolve(base, dir) : dir;
}

/**
 * 「イメージ名で全プロセスを落とす」操作か (#4069 AC4)。
 *
 * 2026-07-29 に `taskkill /F /IM node.exe` が、lock を保持して検証中だった別セッション
 * (PR #4063) を巻き込んで停止させた。**掃除は所有権単位で行う** (`npm run agent:cleanup`)
 * のが正しく、イメージ名一括は誤爆が構造的に避けられないので止める。
 *
 * PID 指定の停止 (`taskkill /F /PID 33176` / `kill -9 <pid>`) は正当な手段なので通す。
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isBulkProcessKillCommand(command) {
	return splitSegments(command).some((segment) => {
		const tokens = tokenize(segment).filter((t) => !t.quoted);
		const head = binName(tokens[0]?.text ?? '');
		const words = tokens.map((t) => t.text);
		if (head === 'taskkill') {
			// `/IM <image>` はイメージ名一括。`/PID <n>` は対象が特定されているので通す。
			return words.some(
				(w, idx) => /^\/im$/i.test(w) && /^node(\.exe)?$/i.test(words[idx + 1] ?? ''),
			);
		}
		if (head === 'killall') return words.slice(1).some((w) => /^node(\.exe)?$/i.test(w));
		if (head === 'pkill') return words.slice(1).some((w) => /^node(\.exe)?$/i.test(w));
		if (head === 'stop-process') {
			return words.some(
				(w, idx) => /^-name$/i.test(w) && /^node(\.exe)?$/i.test(words[idx + 1] ?? ''),
			);
		}
		return false;
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

export default {
	isHeavyCommand,
	isBranchPublishCommand,
	isBulkProcessKillCommand,
	extractTarget,
	taskKeyFromBranch,
	resolvePushRefBranch,
	resolveCommandCwd,
};
