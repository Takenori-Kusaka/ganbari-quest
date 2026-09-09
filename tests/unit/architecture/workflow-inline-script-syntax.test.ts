// tests/unit/architecture/workflow-inline-script-syntax.test.ts
// cspell:ignore shellcheck mynode
// ^ shellcheck = 実在の lint ツール名 (この repo には入っていない、という説明で出てくる)。
//   mynode = 『`node` で終わる別の語』の負例。綴りを直すと例が例でなくなるので直さない。
//
// **workflow の `node -e '…'` インライン script が、構文として成立していることを機械で見る**
// (#4866 / ADR-0061 same-class-N→guard)。
//
// なぜ必要か: `.github/workflows/*.yml` の `run:` に埋めた JS は、**CI では検出できない**。
//   - actionlint / shellcheck は入っていない
//   - workflow step を parse する検査は他に無い
//   - `graphify-refresh.yml` は `ref: develop` を固定 checkout するので、PR branch の
//     内容で `workflow_dispatch` して確かめることもできない
//
// 実際に #4866 では**同じ class を 3 回**踏んだ:
//   1. heredoc の行継続が潰れて 30 件が 1 論理行になり、install が 1 件で成功した
//   2. 更新手順の docker コマンドが `#` 接頭辞ごと引用符の内側に入り、exit 0 / 出力 0 バイト
//   3. `::error::` 文言に足した `bash -c '…'` の apostrophe が `node -e '` を閉じ、
//      **assert step 全体が SyntaxError で死んだ** (happy path を含む 4/4 ケースで)
//
// 3 回目がとくに悪い: apostrophe が step 内で偶数個になるため `bash -n` は PASS し、
// job が落ちるのは merge 後の develop 上だけ。**「緑なのに何もしていない」を潰すための
// workflow が、まさにそれで壊れていた。**
//
// 固定する不変条件:
//   [W1] `node -e '…'` に shell が渡す文字列が、JS として parse できる
//   [W2] その引数が **1 つの完結した shell 語** である
//        = 閉じ引用符の直後が語の続き (`'don'` + `t …`) になっていない
//        + その `run:` ブロック全体の引用が閉じている
//   [W3] どの workflow に何本あるかを file 名つきで固定する (検査が黙って消えない)

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (tests/CLAUDE.md §「repo 走査 test」/ #4085)。
vi.setConfig({ testTimeout: 60_000 });

const ROOT = join(__dirname, '../../..');

/** `run:` に書かれた shell script 1 ブロック。 */
type RunBlock = {
	wf: string;
	/** ブロック本文の 1 行目が YAML 上の何行目か (1-origin)。 */
	startLine: number;
	text: string;
};

/** `run:` ブロックの中で見つけた `node -e '…'` 1 件。 */
type InlineScript = {
	wf: string;
	line: number;
	quote: "'" | '"';
	/** shell が node に渡す文字列 (引用符の内側)。 */
	script: string;
	/** 閉じ引用符が見つかったか。 */
	terminated: boolean;
	/** 閉じ引用符の**直後の 1 文字** (ブロック末尾なら空文字)。 */
	after: string;
};

/** `run:` ブロック 1 件のスキャン結果。 */
type ScannedBlock = {
	block: RunBlock;
	scripts: InlineScript[];
	/** ブロックを読み終えた時点で引用符が閉じているか。 */
	balanced: boolean;
};

/**
 * YAML の block scalar から見た「素の script」に戻す。
 *
 * 行頭のインデントは YAML が剥がすので、ここでも剥がす。剥がさないと
 * template literal の中身が変わり、判定が本物とずれる。
 */
function dedent(s: string): string {
	const lines = s.split('\n');
	const indents = lines
		.filter((l) => l.trim().length > 0)
		.map((l) => /^\s*/.exec(l)?.[0].length ?? 0);
	const min = indents.length > 0 ? Math.min(...indents) : 0;
	return lines.map((l) => l.slice(min)).join('\n');
}

const RUN_KEY = /^(\s*)(?:-\s+)?run:(.*)$/;
const BLOCK_INDICATOR = /^[|>][-+]?\d*$/;

/** `run:` の値 (inline / block scalar 両方) を、YAML が shell に渡す形で取り出す。 */
function extractRunBlocks(yml: string, wf: string): RunBlock[] {
	const lines = yml.split('\n');
	const blocks: RunBlock[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = RUN_KEY.exec(lines[i]);
		if (!m) continue;
		// `- run: |` 形式でも「`run` 自身の列」を基準にする (`-` の列を基準にすると、
		// 同じ step の兄弟 key まで本文に取り込んでしまう)。
		const keyIndent = m[0].indexOf('run:');
		const rest = m[2].trim();
		if (rest !== '' && !BLOCK_INDICATOR.test(rest)) {
			blocks.push({ wf, startLine: i + 1, text: rest });
			continue;
		}
		const body: string[] = [];
		let j = i + 1;
		for (; j < lines.length; j++) {
			const l = lines[j];
			if (l.trim() === '') {
				body.push('');
				continue;
			}
			if ((/^\s*/.exec(l)?.[0].length ?? 0) <= keyIndent) break;
			body.push(l);
		}
		blocks.push({ wf, startLine: i + 2, text: dedent(body.join('\n')) });
		i = j - 1;
	}
	return blocks;
}

/** `node -e '` / `node --eval="` … 綴りを変えるだけで検査から外れないようにする。 */
const OPEN = /node[ \t]+(?:-e|--eval)[ \t=]+(['"])/y;
/** 直前が語の途中でないこと (`mynode -e` / `/usr/bin/node -e` の後半だけを拾わない)。 */
const WORD_CHAR = /[A-Za-z0-9_./-]/;
/** 語として正しく閉じたときに、閉じ引用符の直後に来てよい文字。 */
const SEPARATOR_AFTER = /[\s;&|)<>#]/;

/** 引用の状態。plain = 引用の外。 */
type QuoteState = 'plain' | "'" | '"';
/** 1 文字ぶん進んだ結果。`script` があれば `node -e` の引数を 1 件取り出したという意味。 */
type Step = { i: number; state: QuoteState; script?: Omit<InlineScript, 'wf' | 'line'> };

/** 閉じ引用符の位置を返す (見つからなければ text.length)。二重引用符の `\"` だけ飛ばす。 */
function findClosingQuote(text: string, from: number, quote: "'" | '"'): number {
	for (let k = from; k < text.length; k++) {
		if (quote === '"' && text[k] === '\\') {
			k++;
			continue;
		}
		if (text[k] === quote) return k;
	}
	return text.length;
}

/** `i` から `node -e '…'` が始まっていれば、引数を読み切って返す。 */
function readNodeArg(text: string, i: number): Step | null {
	if (i > 0 && WORD_CHAR.test(text[i - 1])) return null;
	OPEN.lastIndex = i;
	const m = OPEN.exec(text);
	if (!m) return null;
	const quote = m[1] as "'" | '"';
	const argStart = i + m[0].length;
	const close = findClosingQuote(text, argStart, quote);
	const terminated = close < text.length;
	return {
		i: terminated ? close + 1 : text.length,
		state: 'plain',
		script: {
			quote,
			script: text.slice(argStart, close),
			terminated,
			after: terminated ? (text[close + 1] ?? '') : '',
		},
	};
}

/** 引用の内側を 1 文字進める。閉じ引用符に当たったら plain に戻る。 */
function stepInsideQuote(text: string, i: number, state: "'" | '"'): Step {
	// 単一引用符は POSIX でエスケープ不可なので、次の `'` で必ず閉じる。
	if (state === '"' && text[i] === '\\') return { i: i + 2, state };
	return { i: i + 1, state: text[i] === state ? 'plain' : state };
}

/** 引用の外を 1 文字進める。`node -e` に当たったら引数まるごと消費する。 */
function stepPlain(text: string, i: number): Step {
	const c = text[i];
	if (c === '\\') return { i: i + 2, state: 'plain' };
	// `#` コメント (行頭 or 区切りの直後) の中身は shell が読まないので飛ばす。
	if (c === '#' && (i === 0 || /[\s;&|(]/.test(text[i - 1]))) {
		const nl = text.indexOf('\n', i);
		return { i: nl < 0 ? text.length : nl, state: 'plain' };
	}
	if (c === 'n') {
		const hit = readNodeArg(text, i);
		if (hit) return hit;
	}
	if (c === "'" || c === '"') return { i: i + 1, state: c };
	return { i: i + 1, state: 'plain' };
}

/**
 * `run:` ブロックを **shell と同じ引用規則で** 1 文字ずつ読み、`node -e '…'` を取り出す。
 *
 * `node -e` の引数は**まるごと消費して plain 状態に戻す** — 引数の中の引用符が
 * ブロックの引用状態を汚さないようにするため。
 */
function scanRunBlock(block: RunBlock): ScannedBlock {
	const text = block.text;
	const scripts: InlineScript[] = [];
	let state: QuoteState = 'plain';
	let i = 0;
	while (i < text.length) {
		const at = i;
		const step = state === 'plain' ? stepPlain(text, i) : stepInsideQuote(text, i, state);
		if (step.script) {
			const line = block.startLine + text.slice(0, at).split('\n').length - 1;
			scripts.push({ wf: block.wf, line, ...step.script });
		}
		i = step.i;
		state = step.state;
	}
	return { block, scripts, balanced: state === 'plain' };
}

const WORKFLOWS = globSync('.github/workflows/*.yml', { cwd: ROOT })
	.map((f) => f.replace(/\\/g, '/'))
	.sort();

const SCANNED: ScannedBlock[] = WORKFLOWS.flatMap((wf) => {
	const yml = readFileSync(join(ROOT, wf), 'utf8');
	return extractRunBlocks(yml, wf).map(scanRunBlock);
});
const ALL_SCRIPTS = SCANNED.flatMap((s) => s.scripts);

/**
 * どの workflow に何本あるかの実測台帳 (#4866 round 8)。
 *
 * 前版は「合計 3 本以上」という下限だった。合計だと **file をまるごと消しても、別 file に
 * 残っている本数で埋め合わさって緑のまま**になる (実測: `graphify-refresh.yml` を消しても
 * `ci.yml` 2 + `pr-info.yml` 1 = 3 本で下限を満たす)。減ったことに気づけるよう file 名つきで
 * 固定する。
 *
 * **本数が変わったらこの表を同じ commit で直すこと。** 台帳に無い workflow に `node -e` を
 * 書いても fail する (新規追加を黙って検査対象外にしないため)。
 */
const EXPECTED_BY_FILE: Readonly<Record<string, number>> = {
	'.github/workflows/ci.yml': 2,
	'.github/workflows/graphify-refresh.yml': 2,
	'.github/workflows/pr-info.yml': 1,
};

describe('[W1][W2][W3] workflow の node -e インライン script', () => {
	it('workflow を 1 件以上見つけている (glob が空振りしていない)', () => {
		expect(WORKFLOWS.length).toBeGreaterThan(0);
	});

	it('[W3] workflow ごとの検出本数が台帳と一致する (検査が黙って消えない)', () => {
		const actual: Record<string, number> = {};
		for (const s of ALL_SCRIPTS) actual[s.wf] = (actual[s.wf] ?? 0) + 1;
		const files = [...new Set([...Object.keys(EXPECTED_BY_FILE), ...Object.keys(actual)])].sort();
		const diff = files
			.map((f) => ({ f, want: EXPECTED_BY_FILE[f] ?? 0, got: actual[f] ?? 0 }))
			.filter((r) => r.want !== r.got);
		expect(
			diff.map((r) => `${r.f}: 台帳 ${r.want} 本 / 実測 ${r.got} 本`).join('\n'),
			'workflow の node -e / --eval の本数が台帳とずれている。本当に増減したのなら ' +
				'EXPECTED_BY_FILE を同じ commit で直すこと (file ごとに数えているので、' +
				'ある file を消して別 file の本数で埋め合わせることはできない)',
		).toBe('');
	});

	for (const s of ALL_SCRIPTS) {
		const where = `${s.wf}:${s.line}`;

		it(`[W1] ${where} — node ${s.quote === "'" ? "-e '…'" : '-e "…"'} が JS として parse できる`, () => {
			let error: string | null = null;
			try {
				// `new Function` は eval せずに parse だけする (副作用なし)
				new Function(s.script);
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
			expect(
				error,
				`${where} の node -e が JS として parse できない。引用符の内側に同じ引用符を ` +
					'書くと shell がそこで閉じてしまう (#4866 で 3 回踏んだ):\n' +
					`${error}\n---\n${s.script.slice(0, 400)}`,
			).toBeNull();
		});

		it(`[W2] ${where} — node -e の引数が 1 つの完結した語になっている`, () => {
			// #4866 adversarial round 7 / 8: 前版は「閉じ引用符のあと**行末まで**に何が残るか」を
			// 見ていた。これは代理指標で、`2>&1` / `"$(node -e "…")" = x` のような正当な形を
			// 落とす一方、apostrophe 2 個の fixture は素通りした (実測)。
			//
			// 見るべきなのは**閉じ引用符の直後 1 文字**だけ。shell では引用符に語が続くと連結になる:
			//   `node -e 'const a = 1; // don'` + `t …`   ← round 6 で assert step 全体が死んだ形
			//                                    ^ ここが `t` = 語の続き
			// 正しく閉じていれば、直後に来るのは区切りだけ (空白 / 改行 / `;` / `|` / `)` / …)。
			expect(s.terminated, `${where} の node -e が閉じられていない`).toBe(true);
			expect(
				s.after === '' || SEPARATOR_AFTER.test(s.after),
				`${where} の node -e が**途中で閉じている**。引数の中に同じ引用符があると shell が ` +
					'そこで語を閉じ、続きの文字は別の語として連結される (#4866 round 6 で ' +
					`assert step 全体が SyntaxError で死んだ)。閉じ引用符の直後の文字: ${JSON.stringify(s.after)}`,
			).toBe(true);
		});
	}

	for (const scanned of SCANNED.filter((b) => b.scripts.length > 0)) {
		const where = `${scanned.block.wf}:${scanned.block.startLine}`;
		it(`[W2] ${where} — node -e を含む run ブロックの引用が閉じている`, () => {
			// 閉じ引用符の直後 1 文字だけでは、`'…developers' notes …'` のように**空白のあとに
			// 余った引用符が残る**形を取り逃す。ブロックを読み終えた時点で plain 状態に戻って
			// いることを併せて見る (余った 1 個は必ずここで検出される)。
			expect(
				scanned.balanced,
				`${where} の run ブロックで引用符が閉じていない。node -e の引数の外に余った ` +
					'引用符があると、shell が渡す文字列が書いたものとずれる',
			).toBe(true);
		});
	}
});
