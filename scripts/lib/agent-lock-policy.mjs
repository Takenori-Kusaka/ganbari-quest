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
 * **値を取るフラグ**。次のトークンは operand ではなくフラグの値なので、
 * command position の探索から外す。
 *
 * これを見ないと `npm --prefix . run pre-ready` の `.` をサブコマンドとして読み、
 * 実際に pre-ready を起動するコマンドが素通りする (#4094 QM 指摘 1)。
 */
const PKG_VALUE_FLAGS = new Set([
	'--prefix',
	'-C',
	'--workspace',
	'-w',
	'--filter',
	'--cwd',
	'--dir',
]);

/**
 * `git push` の**値を取るフラグ**。これを見ないと `git push -o ci.skip origin br` の
 * `ci.skip` が operand に混じり、refspec の位置がずれて branch を `origin` と
 * 読んでしまう (#4094 QA I2 — 誤った key で無関係な lock を掴む方向の誤爆)。
 *
 * `--force-with-lease` / `--signed` は**値を取らない形が既定**で、値を渡す場合は
 * `=` 付き (`--force-with-lease=<ref>`) になる。ここに入れると
 * `git push --force-with-lease origin <branch>` の `origin` を値として食べてしまい、
 * refspec を見失う (= 実際に効いている判定を壊す) ので入れない。
 */
const PUSH_VALUE_FLAGS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);

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
 * @param {Set<string>} [valueFlags] 「次のトークンが値」であるフラグ集合
 * @returns {number}
 */
function nextWordIndex(tokens, from, valueFlags) {
	for (let i = from; i < tokens.length; i++) {
		const t = tokens[i];
		if (!t || t.quoted) return -1;
		if (t.text.startsWith('-') || t.text.startsWith('/')) {
			// 値を取るフラグは、その値ごと読み飛ばす。飛ばさないと値を
			// サブコマンド / bin 名として読んでしまう (#4094 QM 指摘 1)。
			if (valueFlags?.has(t.text)) i++;
			continue;
		}
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
	// `node node_modules/vitest/vitest.mjs run` のようにスクリプト実体を直接叩く形も
	// 同じ bin として扱う。ここを見ないと「起動は許可されるのに、走り出したら
	// `heavy-process.mjs` に重い検証として検出されて他セッションを全 BLOCK する」
	// という非対称が生まれる (#4094 QM 指摘 1)。
	const stem = name.replace(/\.(m?js|cjs)$/, '');
	if (HEAVY_BINS.has(stem)) return true;
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
		const subIdx = nextWordIndex(tokens, i + 1, PKG_VALUE_FLAGS);
		if (subIdx === -1) return false;
		const sub = tokens[subIdx]?.text ?? '';
		// `npm run <script>` / `pnpm run <script>`
		if (sub === 'run' || sub === 'run-script') {
			const scriptIdx = nextWordIndex(tokens, subIdx + 1, PKG_VALUE_FLAGS);
			if (scriptIdx === -1) return false;
			return HEAVY_NPM_SCRIPTS.test(tokens[scriptIdx]?.text ?? '');
		}
		// `npm exec vitest` / `pnpm dlx vitest`
		if (PACKAGE_RUNNERS.has(sub)) {
			const binIdx = nextWordIndex(tokens, subIdx + 1, PKG_VALUE_FLAGS);
			if (binIdx === -1) return false;
			return isHeavyBin(tokens[binIdx]?.text ?? '', tokens[binIdx + 1]?.text ?? null);
		}
		// `npm test` (run 省略形)
		if (HEAVY_NPM_SCRIPTS.test(sub)) return true;
		// `yarn vitest` / `pnpm vitest run` — パッケージマネージャ直下の bin 実行形。
		// yarn v1 は `yarn <bin>` で node_modules/.bin を叩くのが慣用で、pnpm も同様。
		// ここを見ないと**旧実装が止めていた形が通ってしまう** (ADR-0006、#4094 QM 指摘 1)。
		return isHeavyBin(sub, tokens[subIdx + 1]?.text ?? null);
	}

	if (PACKAGE_RUNNERS.has(head)) {
		const binIdx = nextWordIndex(tokens, i + 1, PKG_VALUE_FLAGS);
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
			if (t.text.startsWith('-')) {
				// 値を取るフラグ (`-o ci.skip` / `--repo <url>`) は値ごと飛ばす。
				// 飛ばさないと値が operand に混じり refspec の位置がずれる (#4094 QA I2)。
				if (PUSH_VALUE_FLAGS.has(t.text)) k++;
				continue;
			}
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
	return resolveCommandCwdEvidence(command, fallbackCwd).cwd;
}

/**
 * `resolveCommandCwd` と同じ解決を行い、**コマンド自身が実行先の根拠を持っていたか**も返す。
 *
 * これが必要なのは #4076 の root class が「判定の入力に実行文脈を使うと、対象と無関係な
 * branch で BLOCK する」ことだからである。`git push` 単独 / `git push -u origin HEAD` の
 * ように refspec も `cd` / `-C` も無い形では、hook から見て**押す先の branch を知る手段が
 * 無い** (Bash tool の cwd はツール呼び出しをまたいで保持されるが、hook payload の `cwd` は
 * セッションの作業ディレクトリであって、それとは限らない)。
 *
 * `fromCommand === false` は「解決したのではなく、セッションの cwd をそのまま使った」という
 * 意味であり、**その値を branch 判定の入力にしてはならない**。
 *
 * @param {string} command
 * @param {string | null} fallbackCwd
 * @returns {{cwd: string | null, fromCommand: boolean}}
 */
export function resolveCommandCwdEvidence(command, fallbackCwd) {
	let cwd = fallbackCwd ?? null;
	let fromCommand = false;
	for (const segment of splitSegments(command)) {
		const parsed = pushTokens(segment);
		if (parsed?.dashCDir) return { cwd: resolvePath(cwd, parsed.dashCDir), fromCommand: true };
		const tokens = tokenize(segment);
		const head = tokens[0];
		if (!head || head.quoted || binName(head.text) !== 'cd') continue;
		// `cd /d E:\path` (cmd.exe) の `/d` はディレクトリではなくスイッチ。
		// 弾かないと `/d` を作業ディレクトリとして解決してしまう (#4094 QA I3)。
		const dir = tokens.slice(1).find((t) => !isCdSwitch(t.text));
		if (!dir) continue;
		cwd = resolvePath(cwd, dir.text);
		fromCommand = true;
	}
	return { cwd, fromCommand };
}

/**
 * `cd` のスイッチか (ディレクトリではない)。
 *
 * POSIX の `-P` / `-L` と cmd.exe の `/d` の両方を弾く。Windows の絶対パスは
 * `E:\...` / `\\server\share` の形で、`/d` のような 1〜2 文字の `/` 始まりとは
 * 区別できる。
 *
 * @param {string} text
 * @returns {boolean}
 */
function isCdSwitch(text) {
	return text.startsWith('-') || /^\/[A-Za-z]$/.test(text);
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
	const segments = splitSegments(command);
	if (segments.some((segment) => isBulkKillSegment(segment))) return true;
	// PowerShell の pipeline 形 (`Get-Process node | Stop-Process -Force`) は
	// **セグメントをまたぐ**ので、セグメント単体では判定できない。この環境の
	// `.claude/settings.json` matcher は `Bash|PowerShell` なので実際に到達する形であり、
	// #4069 の実害 (他セッションの巻き込み kill) が最も起きやすい書き方でもある
	// (#4094 QM 指摘 2 / QA N1)。
	return isProcessPipelineKill(segments);
}

/**
 * 1 セグメント単体でイメージ名一括 kill か。
 *
 * 引用トークンを**捨てずに正規化して**評価する。捨てると `taskkill /F /IM "node.exe"` の
 * ように引用するだけで回避できてしまう (#4094 QM 指摘 2)。ただし**先頭 (実行される
 * コマンド) が引用されていない**ことは要求する — `gh issue create --title "taskkill …"` の
 * ような言及を実行と誤認しないため (#4071 と同じ原則)。
 *
 * @param {string} segment
 * @returns {boolean}
 */
function isBulkKillSegment(segment) {
	const tokens = tokenize(segment);
	const headTok = tokens[0];
	if (!headTok || headTok.quoted) return false;
	const head = binName(headTok.text);
	const words = tokens.map((t) => t.text);
	const isNode = (/** @type {string | undefined} */ w) => /^node(\.exe)?$/i.test(w ?? '');
	if (head === 'taskkill') {
		// `/IM <image>` はイメージ名一括。`/PID <n>` は対象が特定されているので通す。
		return words.some((w, idx) => /^\/im$/i.test(w) && isNode(words[idx + 1]));
	}
	if (head === 'killall' || head === 'pkill') return words.slice(1).some((w) => isNode(w));
	if (head === 'stop-process' || head === 'spps') {
		return words.some((w, idx) => /^-name$/i.test(w) && isNode(words[idx + 1]));
	}
	if (head === 'wmic') {
		// `wmic process where name='node.exe' delete`
		const lower = segment.toLowerCase();
		return lower.includes('node.exe') && /\b(delete|terminate)\b/.test(lower);
	}
	return false;
}

/**
 * PowerShell の「列挙 → 停止」pipeline か。
 *
 * `Get-Process node | Stop-Process -Force` / `Get-Process -Name node | Stop-Process` /
 * `gps node | kill` を止める。停止側のセグメントが無ければ (`Get-Process node |
 * Select-Object`) 通す — 列挙自体は無害である。
 *
 * @param {string[]} segments
 * @returns {boolean}
 */
function isProcessPipelineKill(segments) {
	let enumeratesNode = false;
	for (const segment of segments) {
		const tokens = tokenize(segment);
		const headTok = tokens[0];
		if (!headTok || headTok.quoted) continue;
		const head = binName(headTok.text);
		const words = tokens.slice(1).map((t) => t.text);
		if (head === 'get-process' || head === 'gps' || head === 'ps') {
			if (words.some((w) => /^node(\.exe)?$/i.test(w))) enumeratesNode = true;
			continue;
		}
		// 絞り込み側 (`ps -ef | grep node | xargs kill` / `… | Where-Object {$_.Name -eq 'node'}`)。
		if (head === 'grep' || head === 'select-string' || head === 'where-object') {
			if (words.some((w) => /node(\.exe)?/i.test(w))) enumeratesNode = true;
			continue;
		}
		if (!enumeratesNode) continue;
		// 停止側。`-Id <n>` で個別指定されていても、入力は pipeline の列挙結果なので
		// 一括であることに変わりはない。
		if (head === 'stop-process' || head === 'spps' || head === 'kill') return true;
		if (head === 'xargs' && words.some((w) => binName(w) === 'kill')) return true;
	}
	return false;
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
	resolveCommandCwdEvidence,
};
