/**
 * scripts/lib/ci/pr-body-sections.mjs
 *
 * PR body の **構造化識別子 (`## ` 見出し) を読む判定の SSOT** (#4348)。
 *
 * # なぜ共有するか
 *
 * PR body を入力に取る gate が、それぞれ独自に `body.includes('## X')` /
 * `body.indexOf('## X')` で見出しを探していた。部分一致は以下を全部「見出しがある」と誤判定する:
 *
 *   - HTML コメント内の見出し文字列 (`<!-- ## X を検証する -->`。顧客にも監査にも見えない)
 *   - fenced code block 内の引用
 *   - 本文中の言及 (`下記「X」参照` — AC 表のセルから section 切り出しが始まる実害を実測)
 *   - 前方一致する別見出し (`## X の補足`)
 *
 * 実害は文書化されていた: `.github/INTEGRATION_PR_TEMPLATE.md` は「gate が本文検索するので
 * 説明コメント内に見出しを再掲しない」という**書き手側の回避運用**を持っていた (#4348 で撤去)。
 * 運用で避けている限り、誰かが 1 度コメントに見出しを書けば gate は空振りする。
 *
 * # 判定規約
 *
 *   1. 判定前に HTML コメント / fenced code block を除去する (`scrubPrBody`)
 *   2. 見出しは **行全体の完全一致** (`line.trim() === '## ' + title`) で探す
 *   3. 見つからない場合は `found: false` を返し、**呼び出し側は必ず fail に倒す**
 *      (「検査できなかった」を pass にしない — #4084 / #4255 / #4333 と同じ思想)
 *
 * 利用側: `scripts/pr-template-gate-checks.mjs` / `scripts/check-merge-gate-checklist.mjs` /
 *         `scripts/check-ac-verification-map.mjs`
 */

/**
 * HTML コメント (`<!-- ... -->`) を除去する。
 *
 * template の説明コメントは顧客にも監査にも見えないのに gate を緑にしていた (#4333)。
 * js/bad-tag-filter (CodeQL) 対策で `--!>` 終端も閉じタグとして扱う。
 *
 * @param {string} text
 * @returns {string}
 */
export function stripHtmlComments(text) {
	// js/incomplete-multi-character-sanitization (CodeQL) 対策で不動点まで繰り返す。
	// 1 回の replace では、除去後に残った断片が再び `<!--` … `-->` を構成しうる
	// (例: `<!--<!-- x --> y -->` は 1 回目で内側が消え、残りが新たなコメントになる)。
	// 変化しなくなるまで回すことで「1 回だけ剥がして素通り」を作らない。
	let current = text ?? '';
	for (;;) {
		const next = current.replace(/<!--[\s\S]*?--!?>/g, '');
		if (next === current) return current;
		current = next;
	}
}

/**
 * fenced code block (``` ... ```) を除去する。
 * gate や template の例文をコードブロックで引用しただけで緑にしない。
 *
 * @param {string} text
 * @returns {string}
 */
export function stripFencedCode(text) {
	return (text ?? '').replace(/^```[\s\S]*?^```/gm, '');
}

/**
 * 判定用に PR body を正規化する (改行正規化 + コメント / code block 除去)。
 *
 * @param {string} text
 * @returns {string}
 */
export function scrubPrBody(text) {
	return stripFencedCode(stripHtmlComments((text ?? '').replace(/\r\n?/g, '\n')));
}

/**
 * 見出し指定を `{ level, title }` に分解する。
 * SSOT (`PR_TEMPLATE_SECTIONS.json`) は `## X` 形式、script 内定数は `X` 形式が混在するため
 * どちらでも受ける。`#` が無い場合は H2 (既定) とみなす。
 *
 * @param {string} heading
 * @param {number} [defaultLevel]
 * @returns {{ level: number; title: string }}
 */
export function parseHeadingSpec(heading, defaultLevel = 2) {
	const trimmed = (heading ?? '').trim();
	const m = trimmed.match(/^(#{1,6})\s+(.*)$/);
	if (!m) return { level: defaultLevel, title: trimmed };
	return { level: (m[1] ?? '').length, title: (m[2] ?? '').trim() };
}

/**
 * 指定見出しの section 本体を切り出す (**見出し行そのものは含まない**)。
 *
 * 終端は **同レベル以上の見出し** (H2 指定なら `## ` か `# `) の直前。下位見出し (`### `) では
 * 止めない (同一 section 内の小見出しは所属を変えないため)。
 *
 * @param {string} body PR 本文
 * @param {string} heading 見出し (`## X` / `### X` / `X` のいずれか。`#` 省略時は H2)
 * @param {{ scrub?: boolean }} [options] `scrub: false` で除去前処理を無効化 (既定 true)
 * @returns {{ found: boolean; text: string }}
 */
export function extractSection(body, heading, options = {}) {
	const scrub = options.scrub !== false;
	const { level, title } = parseHeadingSpec(heading);
	const source = scrub ? scrubPrBody(body) : (body ?? '').replace(/\r\n?/g, '\n');
	const lines = source.split('\n');
	const marker = '#'.repeat(level);
	const start = lines.findIndex((l) => l.trim() === `${marker} ${title}`);
	if (start === -1) return { found: false, text: '' };
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((l) => {
		const m = l.match(/^(#{1,6})\s/);
		return m !== null && (m[1] ?? '').length <= level;
	});
	return { found: true, text: (end === -1 ? rest : rest.slice(0, end)).join('\n') };
}

/**
 * `## <title>` の H2 section 本体を切り出す (`extractSection` の H2 固定版)。
 *
 * @param {string} body PR 本文
 * @param {string} heading 見出し (`## X` / `X` どちらでも可)
 * @param {{ scrub?: boolean }} [options]
 * @returns {{ found: boolean; text: string }}
 */
export function extractH2Section(body, heading, options = {}) {
	const { title } = parseHeadingSpec(heading);
	return extractSection(body, `## ${title}`, options);
}

/**
 * `## <title>` の H2 見出しが (コメント / code block の外に) 存在するか。
 *
 * @param {string} body
 * @param {string} heading 見出し (`## X` / `X` どちらでも可)
 * @returns {boolean}
 */
export function hasH2Section(body, heading) {
	return extractH2Section(body, heading).found;
}
