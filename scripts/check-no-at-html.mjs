#!/usr/bin/env node
// scripts/check-no-at-html.mjs
// #3354 (#3243 follow-up): src 配下の Svelte で `{@html ...}` を機械的に禁止する CI gate。
// #3450 (#3446 follow-up): XSS gate 網羅強化。
//   item2 — TS/JS 側 echo sink (`innerHTML =` / `insertAdjacentHTML(` / `outerHTML =`) も走査対象化。
//   item3 — opt-out マーカーは「存在」だけでなく「同一ファイル内に DOMPurify.sanitize 等の
//            sanitizer 実呼び出しが実在する」ことを構造検証する (マーカーだけで未 sanitize の
//            {@html} / innerHTML を恒久許可できる構造的穴を封鎖)。
// #3741 (#3671 same-class 残余): dot 記法限定だった TS sink 検出を同値 sink まで拡張。
//   - bracket 記法 `el['innerHTML'] = x` / `el["outerHTML"] += x` / `el['insertAdjacentHTML'](...)`
//     (QM Tier2 が実証した gate 素通り evasion、dot と同一 sink)
//   - `document.write(x)` / `document.writeln(x)` (+ bracket 形) — 古典的 HTML 注入 sink
//   - logical assignment `??=` / `||=` (exotic だが同 regex で吸収)
//
// 背景: error message 等のサーバ値を `{@html}` / `innerHTML` で描画すると stored/echo XSS が
// 成立する。不変条件「サーバ値は textContent 補間で描画する」は従来 06-UI設計書 + コメント +
// test の人手依存で、将来 callsite が sink を書いても検出する機械 gate が無かった。
// 本 script を `lint:parallel`（CI lint-and-test）に組込み merge blocker 化する。
//
// opt-out 方法 (正当な sanitize 済 HTML 注入、ADR-0025 DOMPurify 等):
//   - Svelte {@html}: 当該行または直前行に `eslint-disable-next-line svelte/no-at-html-tags`
//     または `allow-at-html:` コメントを置く
//   - TS/JS sink: 当該行または直前行に `allow-innerhtml:` コメントを置く
//   いずれも **同一ファイル内に `DOMPurify.sanitize(...)` (または同等 sanitizer) の実呼び出しが
//   必須** (#3450 item3)。マーカーのみで sanitizer 不在の場合は fail する。
//   LP HTML の innerHTML は別 gate（check-lp-innerhtml-tags.mjs）が担う。
//
// 使い方: node scripts/check-no-at-html.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const AT_HTML = /\{@html\b/;
const ALLOW_AT_HTML = /eslint-disable(?:-next-line)?\s+svelte\/no-at-html-tags|allow-at-html:/;
// TS/JS echo sink (#3450 item2 + #3741 bracket/document.write 拡張):
//   1. innerHTML / outerHTML への代入 — dot (`el.innerHTML`) と bracket (`el['innerHTML']` /
//      `el["innerHTML"]`) を同値カバーし、演算子は = / += / ||= / ??= を検出。
//      `(?!=)` で比較演算子 (== / === / !==) を除外する。
//   2. insertAdjacentHTML 呼び出し — dot / bracket 両形。
//   3. document.write / document.writeln 呼び出し — dot / bracket 両形 (`document` レシーバ
//      限定。`writer.write(chunk)` 等の一般 write は誤検出しない)。
const TS_SINK =
	/(?:\.(?:innerHTML|outerHTML)|\[\s*['"](?:innerHTML|outerHTML)['"]\s*\])\s*(?:\+|\|\||\?\?)?=(?!=)|(?:\binsertAdjacentHTML|\[\s*['"]insertAdjacentHTML['"]\s*\])\s*\(|\bdocument\s*(?:\.\s*write(?:ln)?|\[\s*['"]write(?:ln)?['"]\s*\])\s*\(/;
const ALLOW_SINK = /allow-innerhtml:/;
// sanitizer 実呼び出しパターン (#3450 item3)。DOMPurify (ADR-0025) を第一級とし、
// 同等 sanitizer (sanitize-html 等) の呼び出し形も許容する。
const SANITIZER_CALL = /\bDOMPurify\s*\.\s*sanitize\s*\(|\bsanitizeHtml\s*\(/;

/**
 * src 配下を再帰走査して対象拡張子のファイルパスを集める。
 * @param {string} dir
 * @param {readonly string[]} exts
 * @returns {string[]}
 */
function collectFiles(dir, exts) {
	/** @type {string[]} */
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) {
			out.push(...collectFiles(full, exts));
		} else if (exts.some((ext) => name.endsWith(ext))) {
			out.push(full);
		}
	}
	return out;
}

/** コメント行 (// / * / /*) かどうか。doc コメント内のサンプル記述を sink 誤検出しないため。 @param {string} line */
function isCommentLine(line) {
	const t = line.trimStart();
	return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * ファイル内容から `{@html}` 違反行を抽出する純粋関数。
 * 当該行または直前行に allowlist コメントがあれば除外する（opt-out の sanitizer 実在検証は
 * findUnsanitizedAtHtmlOptOuts が担う）。
 *
 * @param {string} content
 * @returns {number[]} 違反行番号（1-origin）
 */
export function findAtHtmlViolations(content) {
	const lines = content.split('\n');
	/** @type {number[]} */
	const hits = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? '';
		if (!AT_HTML.test(line)) continue;
		const prev = lines[i - 1] ?? '';
		if (ALLOW_AT_HTML.test(line) || ALLOW_AT_HTML.test(prev)) continue;
		hits.push(i + 1);
	}
	return hits;
}

/**
 * opt-out 済み `{@html}` のうち、同一ファイル内に sanitizer 実呼び出しが存在しないものを
 * 抽出する (#3450 item3)。マーカーだけ付けて未 sanitize の {@html} を恒久許可する構造的穴を塞ぐ。
 *
 * @param {string} content
 * @returns {number[]} 違反行番号（1-origin）
 */
export function findUnsanitizedAtHtmlOptOuts(content) {
	if (SANITIZER_CALL.test(content)) return [];
	const lines = content.split('\n');
	/** @type {number[]} */
	const hits = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? '';
		if (!AT_HTML.test(line)) continue;
		const prev = lines[i - 1] ?? '';
		if (ALLOW_AT_HTML.test(line) || ALLOW_AT_HTML.test(prev)) {
			hits.push(i + 1);
		}
	}
	return hits;
}

/**
 * TS/JS の innerHTML 系 echo sink を抽出する純粋関数 (#3450 item2 / #3741 拡張)。
 * 検出対象: innerHTML / outerHTML への代入 (= / += / ||= / ??=、dot・bracket 両記法) /
 * `insertAdjacentHTML(` (dot・bracket 両形) / `document.write(` / `document.writeln(`。
 * コメント行は除外。当該行または直前行の `allow-innerhtml:` マーカーで opt-out できるが、
 * opt-out には同一ファイル内の sanitizer 実呼び出しが必須 (item3 と同一原則)。
 *
 * @param {string} content
 * @returns {{ violations: number[], unsanitizedOptOuts: number[] }} 行番号（1-origin）
 */
export function findTsSinkViolations(content) {
	const hasSanitizer = SANITIZER_CALL.test(content);
	const lines = content.split('\n');
	/** @type {number[]} */
	const violations = [];
	/** @type {number[]} */
	const unsanitizedOptOuts = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? '';
		if (isCommentLine(line)) continue;
		if (!TS_SINK.test(line)) continue;
		const prev = lines[i - 1] ?? '';
		if (ALLOW_SINK.test(line) || ALLOW_SINK.test(prev)) {
			if (!hasSanitizer) unsanitizedOptOuts.push(i + 1);
			continue;
		}
		violations.push(i + 1);
	}
	return { violations, unsanitizedOptOuts };
}

function main() {
	/** @type {string[]} */
	const atHtmlViolations = [];
	/** @type {string[]} */
	const unsanitizedAtHtml = [];
	/** @type {string[]} */
	const sinkViolations = [];
	/** @type {string[]} */
	const unsanitizedSinks = [];

	const svelteFiles = collectFiles(SRC, ['.svelte']);
	for (const f of svelteFiles) {
		const content = readFileSync(f, 'utf-8');
		const rel = relative(ROOT, f);
		for (const ln of findAtHtmlViolations(content)) atHtmlViolations.push(`${rel}:${ln}`);
		for (const ln of findUnsanitizedAtHtmlOptOuts(content)) unsanitizedAtHtml.push(`${rel}:${ln}`);
	}

	// TS/JS sink は .svelte の <script> 内も含めて走査する (#3450 item2)
	const scriptFiles = collectFiles(SRC, ['.ts', '.js', '.mjs', '.svelte']);
	for (const f of scriptFiles) {
		const content = readFileSync(f, 'utf-8');
		const rel = relative(ROOT, f);
		const { violations, unsanitizedOptOuts } = findTsSinkViolations(content);
		for (const ln of violations) sinkViolations.push(`${rel}:${ln}`);
		for (const ln of unsanitizedOptOuts) unsanitizedSinks.push(`${rel}:${ln}`);
	}

	let failed = false;

	if (atHtmlViolations.length > 0) {
		failed = true;
		console.error(
			`[check-no-at-html] FAIL — ${atHtmlViolations.length} 件の {@html} を検出 (XSS リスク、#3354):`,
		);
		for (const v of atHtmlViolations) console.error(`  ${v}`);
		console.error(
			'\nサーバ値は textContent 補間で描画してください。正当な sanitize 済 HTML 注入が必要なら' +
				' 当該行直前に `eslint-disable-next-line svelte/no-at-html-tags` を置き、' +
				'同一ファイル内で DOMPurify.sanitize を実呼び出ししてください (#3450 item3)。',
		);
	}

	if (unsanitizedAtHtml.length > 0) {
		failed = true;
		console.error(
			`[check-no-at-html] FAIL — ${unsanitizedAtHtml.length} 件の opt-out 済 {@html} に` +
				' sanitizer 実呼び出しが同一ファイル内に存在しません (#3450 item3):',
		);
		for (const v of unsanitizedAtHtml) console.error(`  ${v}`);
		console.error(
			'\nopt-out マーカーの存在だけでは不十分です。同一ファイル内で `DOMPurify.sanitize(...)`' +
				' (ADR-0025) 等の sanitizer を実呼び出しして値を無害化してください。',
		);
	}

	if (sinkViolations.length > 0) {
		failed = true;
		console.error(
			`[check-no-at-html] FAIL — ${sinkViolations.length} 件の TS/JS innerHTML 系 sink を検出` +
				' (XSS リスク、#3450 item2):',
		);
		for (const v of sinkViolations) console.error(`  ${v}`);
		console.error(
			'\nDOM への HTML 文字列注入 (`innerHTML =` / `insertAdjacentHTML` / `outerHTML =` /' +
				' `document.write`、bracket 記法含む #3741) は textContent / DOM API で代替してください。' +
				'正当な sanitize 済注入が必要なら当該行直前に `allow-innerhtml:` コメントを置き、' +
				'同一ファイル内で DOMPurify.sanitize を実呼び出ししてください。',
		);
	}

	if (unsanitizedSinks.length > 0) {
		failed = true;
		console.error(
			`[check-no-at-html] FAIL — ${unsanitizedSinks.length} 件の opt-out 済 innerHTML sink に` +
				' sanitizer 実呼び出しが同一ファイル内に存在しません (#3450 item3):',
		);
		for (const v of unsanitizedSinks) console.error(`  ${v}`);
	}

	if (failed) {
		process.exit(1);
	}
	console.log(
		`[check-no-at-html] OK — src 配下 ${svelteFiles.length} svelte に {@html} なし / ` +
			`${scriptFiles.length} script file に未許可 innerHTML sink なし (#3354 / #3450)`,
	);
}

import { fileURLToPath } from 'node:url';

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	main();
}
