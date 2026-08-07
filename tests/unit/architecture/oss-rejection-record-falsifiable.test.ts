// tests/unit/architecture/oss-rejection-record-falsifiable.test.ts
// #4395: 「OSS 調査済み・不採用記録」の各行に、不採用が今も成立していることを
// 機械で否定できる証拠 (= 不在プローブ) を持たせる。
//
// 背景:
//   Graphify は 2026-07-29 に「不採用」として本表に記録されたあと、2026-08-06 (#4343) に
//   採用され、graphify-out/ が git 追跡され hook が毎コミット走る状態になった。にもかかわらず
//   表は不採用のまま残り、「調べたか / 結論 / 何が変われば覆るか」を 1 行で答えるという
//   表の役割が**逆向きに機能した** (読んだ人は「未採用」と判断する)。
//
//   表自身が削除トリガ (a)「採用したなら §OSS 採用記録 へ移す」を定めていたが、
//   移動は人の注意に依存していて発火しなかった。
//
// 何を機械化するか:
//   「その OSS が実際には使われている」ことは、リポジトリ内の痕跡 (追跡ファイル / 依存 /
//   設定) の**存在**で判定できる。各行に「これが存在したら不採用は嘘」というパスを
//   宣言させ、存在したら fail させる。宣言できない候補は、そもそも採用の有無を
//   後から判定できないので表に載せない。
//
// Canon TDD test list:
//   [OR1] 不採用記録の全行が「不在の証明」列を持ち、値が空でない
//   [OR2] 宣言されたパスがリポジトリに存在しない (存在 = その OSS は実は使われている)
//   [OR3] 不採用記録に載っている OSS が §OSS 採用記録 にも載っていない (両立しない)
//   [OR4] パーサ自体が、痕跡ありの行を fixture で fail させられる (guard の生存確認)

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const README = join(REPO_ROOT, 'docs', 'decisions', 'README.md');

const REJECTION_HEADING = '### OSS 調査済み・不採用記録';
const ADOPTION_HEADING = '### OSS 採用記録';
/** 不在の証明列のヘッダ名。表の契約そのものなので定数で固定する。 */
const ABSENCE_PROBE_COLUMN = '不在の証明';

interface TableRow {
	cells: string[];
	header: string[];
	line: number;
}

/** `## `/`### ` 見出しで区切られた節の本文を取り出す。 */
function sectionOf(markdown: string, heading: string): string {
	const lines = markdown.split(/\r?\n/);
	const start = lines.findIndex((l) => l.trim() === heading);
	if (start === -1) return '';
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((l) => /^#{2,3} /.test(l));
	return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** markdown の表を「ヘッダ + 行」に読む。区切り行 (`|---|`) は落とす。 */
function parseTable(section: string, lineOffset = 0): TableRow[] {
	const lines = section.split(/\r?\n/);
	const rowsRaw: { cells: string[]; line: number }[] = [];
	for (const [i, line] of lines.entries()) {
		if (!line.trim().startsWith('|')) continue;
		const cells = line
			.trim()
			.replace(/^\|/, '')
			.replace(/\|$/, '')
			.split('|')
			.map((c) => c.trim());
		if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
		rowsRaw.push({ cells, line: lineOffset + i + 1 });
	}
	if (rowsRaw.length === 0) return [];
	const header = rowsRaw[0].cells;
	return rowsRaw.slice(1).map((r) => ({ cells: r.cells, header, line: r.line }));
}

/** 行の「不在の証明」セルから、リポジトリ相対のパス候補を取り出す。 */
function probePathsOf(row: TableRow): string[] {
	const idx = row.header.indexOf(ABSENCE_PROBE_COLUMN);
	if (idx === -1) return [];
	const cell = row.cells[idx] ?? '';
	// バッククォートで囲んだものだけをパスとして解釈する (説明文を誤ってパス扱いしない)。
	return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((p) => p.length > 0);
}

async function readRejectionRows(): Promise<TableRow[]> {
	const md = await readFile(README, 'utf8');
	return parseTable(sectionOf(md, REJECTION_HEADING));
}

describe('#4395 OSS 不採用記録は「不採用が今も成立する」ことを機械で否定できる', () => {
	it('[OR1] 全行が空でない「不在の証明」を持つ', async () => {
		const rows = await readRejectionRows();
		const missing = rows
			.filter((r) => probePathsOf(r).length === 0)
			.map((r) => `${README}:${r.line} → ${r.cells[1] ?? r.cells[0]}`);

		expect(
			missing,
			`不採用記録の行に「${ABSENCE_PROBE_COLUMN}」列 (バッククォート囲みのパス) がありません。\n` +
				'この列が無いと「実は採用済み」を機械で検出できず、表が「未採用」と誤答し続けます (#4395 の Graphify)。\n' +
				`該当:\n${missing.join('\n')}`,
		).toEqual([]);
	});

	it('[OR2] 宣言されたパスがリポジトリに存在しない', async () => {
		const rows = await readRejectionRows();
		const present: string[] = [];
		for (const row of rows) {
			for (const p of probePathsOf(row)) {
				if (existsSync(join(REPO_ROOT, p))) {
					present.push(`${README}:${row.line} → ${p} が存在する`);
				}
			}
		}

		expect(
			present,
			'不採用と記録されている OSS の痕跡がリポジトリに存在します。\n' +
				'採用されたのに表が不採用のままである可能性が高いので、§OSS 採用記録 へ移してください\n' +
				'(本表の削除トリガ (a))。\n' +
				`該当:\n${present.join('\n')}`,
		).toEqual([]);
	});

	it('[OR3] 不採用記録の OSS が採用記録にも載っていない', async () => {
		const md = await readFile(README, 'utf8');
		const rejection = sectionOf(md, REJECTION_HEADING);
		const adoption = sectionOf(md, ADOPTION_HEADING);
		// 表記ゆれを避けるため、リンクラベル (`[Name](url)` の Name) で突き合わせる。
		const names = [...rejection.matchAll(/\[([^\]]+)\]\(https?:[^)]+\)/g)].map((m) => m[1]);
		const both = names.filter((n) => adoption.includes(n));

		expect(
			both,
			`同じ OSS が採用記録と不採用記録の両方にあります: ${both.join(', ')}`,
		).toEqual([]);
	});

	it('[OR4] 痕跡ありの行を fail させられる (guard 自体の生存確認)', () => {
		// 表が 0 行でも guard が生きていることを、既知の実在パスを持つ fixture で示す。
		const fixture = [
			`| 領域 | 調査 OSS | 調査日 | 結論 | 再評価トリガ | ${ABSENCE_PROBE_COLUMN} | 詳細 |`,
			'|---|---|---|---|---|---|---|',
			'| x | [Fake](https://example.com/fake) | 2026-01-01 | 不採用 | なし | `package.json` | - |',
		].join('\n');
		const rows = parseTable(fixture);

		expect(rows).toHaveLength(1);
		const probes = probePathsOf(rows[0]);
		expect(probes).toEqual(['package.json']);
		// package.json は必ず存在する → [OR2] の検出ロジックが真に働くことの証明。
		expect(probes.some((p) => existsSync(join(REPO_ROOT, p)))).toBe(true);
	});
});
