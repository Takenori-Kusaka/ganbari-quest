/**
 * labels 層 (`src/lib/domain/labels.ts` + `src/lib/domain/labels/*.ts`) / `terms.ts` を
 * テキストとして読む SSOT helper。
 *
 * TypeScript を実行できない build-time script (LP ラベル生成 / リリース通知生成 / orphan 検出) と、
 * labels の本文を文字列として検査する test は、**labels 層のファイル一覧と本文を本 module から得る**
 * (#4965)。labels 層は `labels.ts` (import 入口。`export * from './labels/<file>'` だけを並べる) と
 * `labels/*.ts` (宣言本体。置き場所の規則は docs/DESIGN.md §6) に分かれており、
 * 1 ファイルだけを読むと他のファイルに置かれた namespace を黙って見落とす。
 *
 * 単純な `key: 'value'` ブロックの parser (`parseSimpleBlock`) は #565 で generate-lp-labels.mjs 内に
 * 置かれていたものを、#4883 で build-release-notes.mjs と共有するために切り出した
 * (使い捨て script 禁止 #1442)。値に template literal / 関数呼び出しを含む namespace は対象外であり、
 * その解決は `scripts/generate-lp-labels.mjs` 側が担う。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** labels 層の import 入口 (repo 相対 POSIX パス)。利用側は `$lib/domain/labels` をここに解決する。 */
export const LABELS_ENTRY = 'src/lib/domain/labels.ts';

/** labels 層の宣言本体を置くディレクトリ (repo 相対 POSIX パス)。サブディレクトリは作らない。 */
export const LABELS_DIR = 'src/lib/domain/labels';

/**
 * `labels/` 直下にあっても labels 層のソースとみなさないファイル名 (test / spec)。
 * `labelSourceFiles()` と `isLabelsLayerPath()` の両方がこれで除く (範囲の定義を 1 箇所に置く)。
 */
const NON_SOURCE_NAME = /\.(test|spec)\.ts$/;

/**
 * labels 層のソースファイル一覧を返す (repo 相対 POSIX パス)。
 *
 * 入口 → `labels/*.ts` (名前順) の順。一覧は入口の `export *` 行ではなくディレクトリの実体から作る。
 * 入口に `export *` を書き忘れたファイル (TS から import されず script だけが読む LP 用 namespace 等) も
 * テキスト検査から漏らさないため。
 *
 * @param {string} [repoRoot] repo のルート (test 用に差し替え可能)
 * @returns {string[]}
 * @throws {Error} `labels/` にサブディレクトリがあるとき (フラット構成の前提が崩れ、一覧から漏れるため)
 */
export function labelSourceFiles(repoRoot = REPO_ROOT) {
	const files = [LABELS_ENTRY];
	const dir = path.join(repoRoot, LABELS_DIR);
	if (!fs.existsSync(dir)) return files;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
	if (subdirs.length > 0) {
		throw new Error(
			`${LABELS_DIR}/ にサブディレクトリがあります (${subdirs.join(', ')})。labels 層はフラット構成です ` +
				'(docs/DESIGN.md §6)。ファイルは labels/ 直下に置いてください。',
		);
	}
	const names = entries
		.filter((e) => e.isFile() && e.name.endsWith('.ts') && !NON_SOURCE_NAME.test(e.name))
		.map((e) => e.name)
		.sort();
	for (const name of names) files.push(`${LABELS_DIR}/${name}`);
	return files;
}

/**
 * labels 層の全ソースを連結した本文を返す (`labelSourceFiles()` の順、改行区切り)。
 *
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function readLabelsSource(repoRoot = REPO_ROOT) {
	return labelSourceFiles(repoRoot)
		.map((rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8'))
		.join('\n');
}

/**
 * パスが labels 層 (入口 or `labels/*.ts`) を指すか。
 *
 * 範囲は `labelSourceFiles()` が返す一覧と同じで、`labels/` 直下の `*.test.ts` / `*.spec.ts` は含めない。
 * 含めると、本文 (`readLabelsSource()`) には入らないのに、orphan 検出では定義元の側に数えられて
 * そこからの参照が外部参照にならない、と判定が割れる。
 *
 * @param {string} filePath repo 相対パス (区切りは `/` / `\` どちらも可) か絶対パス
 * @param {string} [repoRoot]
 * @returns {boolean}
 */
export function isLabelsLayerPath(filePath, repoRoot = REPO_ROOT) {
	const rel = (path.isAbsolute(filePath) ? path.relative(repoRoot, filePath) : filePath)
		.replace(/\\/g, '/')
		.replace(/^\.\//, '');
	if (rel === LABELS_ENTRY) return true;
	if (!rel.startsWith(`${LABELS_DIR}/`) || !rel.endsWith('.ts')) return false;
	const name = rel.slice(LABELS_DIR.length + 1);
	return !name.includes('/') && !NON_SOURCE_NAME.test(name);
}

/**
 * labels 層の単純な `key: 'value'` ブロックを行単位でパースする。
 *
 * @param {string} src 対象の本文 (`readLabelsSource()` の結果など)
 * @param {string} constName `export const <constName>` の名前
 * @returns {Record<string, string>}
 * @throws {Error} 対象 const が見つからないとき (無言で空を返すと SSOT ずれに気付けない)
 */
export function parseSimpleBlock(src, constName) {
	const pattern = new RegExp(`export const ${constName}\\b[^{]*{([^}]+)}`, 's');
	const match = src.match(pattern);
	if (!match || match[1] === undefined) {
		throw new Error(
			`${constName} not found in label sources (${LABELS_ENTRY} + ${LABELS_DIR}/*.ts)`,
		);
	}
	/** @type {Record<string, string>} */
	const result = {};
	for (const line of match[1].split('\n')) {
		const m = line.match(/(\w+):\s*'([^']+)'/);
		if (m && m[1] !== undefined && m[2] !== undefined) result[m[1]] = m[2];
	}
	return result;
}

export default parseSimpleBlock;
