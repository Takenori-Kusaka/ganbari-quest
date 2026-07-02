#!/usr/bin/env node
// scripts/check-no-at-html.mjs
// #3354 (#3243 follow-up): src 配下の Svelte で `{@html ...}` を機械的に禁止する CI gate。
//
// 背景: error message 等のサーバ値を `{@html}` で描画すると stored/echo XSS が成立する。
// 不変条件「サーバ値は textContent 補間で描画する」は従来 06-UI設計書 + コメント + test の
// 人手依存で、将来 callsite が `{@html resolveApiErrorMessage(...)}` を書いても検出する
// 機械 gate が無かった。本 script を `lint:parallel`（CI lint-and-test）に組込み merge blocker 化する。
//
// 正当な sanitize 済 HTML 注入（ADR-0025 DOMPurify 等）が必要な場合は、当該行または直前行に
// `eslint-disable-next-line svelte/no-at-html-tags` または `allow-at-html:` コメントを置いて opt-out する
// （レビューで sanitize を確認すること）。LP HTML の innerHTML は別 gate（check-lp-innerhtml-tags.mjs）が担う。
//
// 使い方: node scripts/check-no-at-html.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const AT_HTML = /\{@html\b/;
const ALLOW = /eslint-disable(?:-next-line)?\s+svelte\/no-at-html-tags|allow-at-html:/;

/** src 配下を再帰走査して .svelte ファイルパスを集める。 @param {string} dir @returns {string[]} */
function collectSvelte(dir) {
	/** @type {string[]} */
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) {
			out.push(...collectSvelte(full));
		} else if (name.endsWith('.svelte')) {
			out.push(full);
		}
	}
	return out;
}

/**
 * ファイル内容から `{@html}` 違反行を抽出する純粋関数。
 * 当該行または直前行に allowlist コメントがあれば除外する。
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
		if (ALLOW.test(line) || ALLOW.test(prev)) continue;
		hits.push(i + 1);
	}
	return hits;
}

function main() {
	const files = collectSvelte(SRC);
	/** @type {string[]} */
	const violations = [];
	for (const f of files) {
		const lines = findAtHtmlViolations(readFileSync(f, 'utf-8'));
		for (const ln of lines) violations.push(`${relative(ROOT, f)}:${ln}`);
	}
	if (violations.length > 0) {
		console.error(
			`[check-no-at-html] FAIL — ${violations.length} 件の {@html} を検出 (XSS リスク、#3354):`,
		);
		for (const v of violations) console.error(`  ${v}`);
		console.error(
			'\nサーバ値は textContent 補間で描画してください。正当な sanitize 済 HTML 注入が必要なら' +
				' 当該行直前に `eslint-disable-next-line svelte/no-at-html-tags` を置き、レビューで sanitize を確認。',
		);
		process.exit(1);
	}
	console.log(`[check-no-at-html] OK — src 配下 ${files.length} svelte に {@html} なし`);
}

import { fileURLToPath } from 'node:url';

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	main();
}
