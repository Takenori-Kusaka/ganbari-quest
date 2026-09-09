// tests/unit/architecture/workflow-inline-script-syntax.test.ts
// cspell:ignore shellcheck
// ^ 実在の lint ツール名 (この repo には入っていない、という説明で出てくる)。
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
//   [W1] `node -e '…'` の中身が JS として parse できる
//   [W2] `node -e '…'` の内側に生の apostrophe が無い (shell がそこで閉じてしまう)

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');

type InlineScript = {
	script: string;
	line: number;
	quote: "'" | '"';
	/** 閉じ引用符のあとに、同じ行で何が残っているか (空でないなら途中で閉じている)。 */
	trailing: string;
	terminated: boolean;
};

/**
 * `node -e '…'` / `node -e "…"` を、**shell と同じ規則で** (次の同じ引用符で閉じる) 取り出す。
 *
 * `--eval` の別綴りも見る。単一引用符は POSIX でエスケープ不可なので、次の `'` で必ず閉じる。
 * 二重引用符は `\"` でエスケープできるので、それだけは飛ばす。
 */
function extractInlineNodeScripts(yml: string): InlineScript[] {
	const OPEN = /\bnode\s+(?:-e|--eval)\s+(['"])/g;
	const found: InlineScript[] = [];
	for (;;) {
		const m = OPEN.exec(yml);
		if (!m) return found;
		const quote = m[1] as "'" | '"';
		const start = m.index + m[0].length;
		let end = -1;
		for (let k = start; k < yml.length; k++) {
			if (yml[k] === '\\' && quote === '"') {
				k++;
				continue;
			}
			if (yml[k] === quote) {
				end = k;
				break;
			}
		}
		const line = yml.slice(0, m.index).split('\n').length;
		if (end < 0) {
			found.push({ script: yml.slice(start), line, quote, trailing: '', terminated: false });
			return found;
		}
		const lineEnd = yml.indexOf('\n', end);
		found.push({
			script: yml.slice(start, end),
			line,
			quote,
			trailing: yml.slice(end + 1, lineEnd < 0 ? yml.length : lineEnd).trim(),
			terminated: true,
		});
		OPEN.lastIndex = end + 1;
	}
}

/**
 * YAML の block scalar (`run: |`) から見た「素の script」に戻す。
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

const WORKFLOWS = globSync('.github/workflows/*.yml', { cwd: ROOT })
	.map((f) => f.replace(/\\/g, '/'))
	.sort();

/** 検出できているべき最小本数。0 本になったら検査が消えたのと同じ (#4866 round 7)。 */
const MIN_INLINE_SCRIPTS = 3;

const ALL_SCRIPTS = WORKFLOWS.flatMap((wf) => {
	const yml = readFileSync(join(ROOT, wf), 'utf8');
	return extractInlineNodeScripts(yml).map((s) => ({ ...s, wf }));
});

describe('[W1][W2] workflow の node -e インライン script', () => {
	it('workflow を 1 件以上見つけている (glob が空振りしていない)', () => {
		expect(WORKFLOWS.length).toBeGreaterThan(0);
	});

	it(`node -e / --eval を ${MIN_INLINE_SCRIPTS} 本以上見つけている (検査が黙って消えない)`, () => {
		// #4866 adversarial round 7: 前版は per-file の `if (scripts.length === 0) continue;` だけで
		// 下限が無く、**引用符の綴りを変えるだけで検査ごと消せた** (しかも [W1] の失敗メッセージが
		// 「文字列は二重引用符で書くこと」と、その逃げ道を自ら案内していた)。単一 / 二重の
		// 両方を見るようにしたうえで、本数に下限を置く。
		expect(
			ALL_SCRIPTS.length,
			`検出 ${ALL_SCRIPTS.length} 本。workflow から node -e が本当に減ったのなら、` +
				'この期待値も同じ commit で下げること (黙って減らせないようにしてある)',
		).toBeGreaterThanOrEqual(MIN_INLINE_SCRIPTS);
	});

	for (const s of ALL_SCRIPTS) {
		const where = `${s.wf}:${s.line}`;

		it(`${where} — node ${s.quote === "'" ? "-e '…'" : '-e "…"'} が JS として parse できる`, () => {
			const body = dedent(s.script);
			let error: string | null = null;
			try {
				// `new Function` は eval せずに parse だけする (副作用なし)
				new Function(body);
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
			expect(
				error,
				`${where} の node -e が JS として parse できない。引用符の内側に同じ引用符を ` +
					'書くと shell がそこで閉じてしまう (#4866 で 3 回踏んだ):\n' +
					`${error}\n---\n${body.slice(0, 400)}`,
			).toBeNull();
		});

		it(`${where} — 引用符が途中で閉じていない`, () => {
			// #4866 adversarial round 7: 前版は「二重引用符が偶数か」という**代理指標**で、
			// 宣言している不変条件 (内側に同じ引用符が無い) を見ていなかった。apostrophe を
			// 2 個入れると偶数のまま素通りする (実測)。**閉じ引用符の直後**を見る。
			//
			// 正常な閉じ方のあとに来るのは shell の区切りだけ:
			//   `node -e '…'` (行末) / `$(node -e "…")` / `$(node -e "…"); then` / `… | …`
			// 内側の引用符で先に閉じてしまうと、そこには**裸の語**が続く
			//   `node -e '… bash -c '` + `pip install …`  ← round 6 で assert step 全体が死んだ形
			expect(s.terminated, `${where} の node -e が閉じられていない`).toBe(true);
			const afterCloser = s.trailing.replace(/^[)\s]*/, '');
			expect(
				afterCloser === '' || /^[;&|<>#]/.test(afterCloser),
				`${where} の node -e が**途中で閉じている**。内側に同じ引用符を書くと shell が ` +
					'そこで閉じ、残りは別のコマンドとして解釈される (#4866 round 6 で ' +
					`assert step 全体が SyntaxError で死んだ)。閉じたあとに続く語: ${afterCloser}`,
			).toBe(true);
		});
	}
});
