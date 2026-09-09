// tests/unit/architecture/workflow-inline-script-syntax.test.ts
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

/** `node -e '` … `'` を、**shell と同じ規則で** (最初の `'` で閉じる) 取り出す。 */
function extractInlineNodeScripts(yml: string): { script: string; line: number }[] {
	const OPEN = "node -e '";
	const found: { script: string; line: number }[] = [];
	let from = 0;
	for (;;) {
		const i = yml.indexOf(OPEN, from);
		if (i < 0) return found;
		const start = i + OPEN.length;
		// POSIX の single quote は**エスケープ不可**。次の `'` で必ず閉じる。
		const end = yml.indexOf("'", start);
		if (end < 0) {
			found.push({ script: yml.slice(start), line: yml.slice(0, i).split('\n').length });
			return found;
		}
		found.push({ script: yml.slice(start, end), line: yml.slice(0, i).split('\n').length });
		from = end + 1;
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

describe('[W1][W2] workflow の node -e インライン script', () => {
	it('workflow を 1 件以上見つけている (glob が空振りしていない)', () => {
		expect(WORKFLOWS.length).toBeGreaterThan(0);
	});

	for (const wf of WORKFLOWS) {
		const yml = readFileSync(join(ROOT, wf), 'utf8');
		const scripts = extractInlineNodeScripts(yml);
		if (scripts.length === 0) continue;

		it(`${wf} — ${scripts.length} 本の node -e が JS として parse できる`, () => {
			for (const { script, line } of scripts) {
				const body = dedent(script);
				let error: string | null = null;
				try {
					// `new Function` は eval せずに parse だけする (副作用なし)
					new Function(body);
				} catch (e) {
					error = e instanceof Error ? e.message : String(e);
				}
				expect(
					error,
					`${wf}:${line} の node -e '…' が JS として parse できない。` +
						'`node -e` の内側に apostrophe を書くと shell がそこで閉じてしまう ' +
						'(#4866 で 3 回踏んだ)。文字列は二重引用符で書くこと:\n' +
						`${error}\n---\n${body.slice(0, 400)}`,
				).toBeNull();
			}
		});

		it(`${wf} — node -e の内側に途中で閉じる apostrophe が無い`, () => {
			// `node -e '` の開始位置と、抽出した script の終端の関係を見る。抽出は「最初の `'`」で
			// 切っているので、**本来の終端より手前で切れていれば** 残りが shell 側に漏れている。
			// 症状として、script が `+ "…` のような**未終端の文字列**で終わる。
			for (const { script, line } of scripts) {
				const quotes = (script.match(/"/g) ?? []).length;
				expect(
					quotes % 2,
					`${wf}:${line} の node -e '…' が二重引用符の途中で切れている = ` +
						'内側の apostrophe で shell が先に閉じている (#4866 round 6 で実際に起きた)',
				).toBe(0);
			}
		});
	}
});
