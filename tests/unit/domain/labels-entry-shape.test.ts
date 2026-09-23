// tests/unit/domain/labels-entry-shape.test.ts
// labels 層の入口 (src/lib/domain/labels.ts) の形を検査する (#4965、docs/DESIGN.md §6)。
//
// 入口は `export * from './labels/<file>';` を名前順に並べるだけで、宣言を持たない。次の 2 つは
// 型検査でも既存の text 検査でも捕まらないため、ここで止める:
//   1. 入口に宣言を置く — export 付きの宣言は同名の `export *` を黙って上書きする (TS はエラーにしない)。
//      非 export の宣言は別ファイルの namespace から参照できない
//   2. labels/ のファイルを入口に足し忘れる — TS から import されず script だけが読むファイル
//      (LP 用 namespace 等) は、足し忘れても型検査が通る。labels を text として読む道具は
//      labelSourceFiles() がディレクトリの実体から一覧を作るので漏れないが、入口をパスで読む道具が
//      加わると、その道具は足し忘れたファイルを黙って見落とす
// 同名の export の重複は入口の `export *` の TS2308 (svelte-check) が止めるので、ここでは見ない
// (ADR-0045 §3.5)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LABELS_ENTRY, labelSourceFiles } from '../../../scripts/lib/parse-labels-ts.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** 入口に置いてよい re-export 行。捕獲するのは labels/ 直下のファイル名 (拡張子なし)。 */
const EXPORT_STAR_LINE = /^export \* from '\.\/labels\/([a-z0-9-]+)';$/;

function readEntryLines(): string[] {
	return fs.readFileSync(path.join(REPO_ROOT, LABELS_ENTRY), 'utf8').split(/\r?\n/);
}

/** labels/ 直下の labels 層ファイル (拡張子なし、名前順)。一覧は入口ではなくディレクトリの実体から作る。 */
function labelFileStems(): string[] {
	return labelSourceFiles()
		.filter((rel) => rel !== LABELS_ENTRY)
		.map((rel) => path.posix.basename(rel, '.ts'));
}

describe('labels 層の入口 (src/lib/domain/labels.ts) の形 (#4965)', () => {
	it('入口は `export * from ./labels/<file>` 行・// コメント・空行だけで、宣言を持たない', () => {
		const offending = readEntryLines()
			.map((line, index) => ({ line: line.trim(), lineNo: index + 1 }))
			.filter(({ line }) => line !== '' && !line.startsWith('//') && !EXPORT_STAR_LINE.test(line));
		expect(
			offending.map(({ line, lineNo }) => `  ${LABELS_ENTRY}:${lineNo} ${line}`),
			`${LABELS_ENTRY} に \`export * from './labels/<file>';\` 以外の行があります。` +
				'宣言は docs/DESIGN.md §6 の配置規則で決まる src/lib/domain/labels/<file>.ts に置き、入口には置かないでください ' +
				'(入口の export 付き宣言は同名の export * を黙って上書きします)。',
		).toEqual([]);
	});

	it('labels/ 直下の全ファイルを 1 行ずつ、名前順で export * している', () => {
		const exported = readEntryLines()
			.map((line) => EXPORT_STAR_LINE.exec(line.trim())?.[1])
			.filter((stem): stem is string => stem !== undefined);
		const files = labelFileStems();
		const missing = files.filter((stem) => !exported.includes(stem));
		const unknown = exported.filter((stem) => !files.includes(stem));
		const duplicated = exported.filter((stem, index) => exported.indexOf(stem) !== index);
		expect(
			exported,
			`${LABELS_ENTRY} の export * が labels/ 直下のファイルと一致しません。` +
				` 足りない: [${missing.join(', ')}] / 実在しない: [${unknown.join(', ')}] / 重複: [${duplicated.join(', ')}]。` +
				" ファイルを足したら同じ PR で入口に `export * from './labels/<file>';` を名前順で 1 行足してください (docs/DESIGN.md §6)。",
		).toEqual(files);
	});
});
