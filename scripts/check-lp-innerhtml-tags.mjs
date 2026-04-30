#!/usr/bin/env node
// scripts/check-lp-innerhtml-tags.mjs
// #1747 AC2: LP innerHTML 注入後の構造タグ保持を静的検査で毎 PR 即時検出する。
//
// 動作:
//   1. site/shared-labels.js (labels.ts から自動生成) を読み込み LP_LABELS を取り出す
//   2. JSDOM + DOMPurify で SANITIZE_CONFIG.ALLOWED_TAGS を使って各 namespace 値を sanitize
//   3. sanitize 前後で「主要構造タグ (h1/h2/h3/p/ul/ol/li/table/tr/th/td/header/section/strong/a/br) が
//      strip されていないか」を比較
//   4. strip された場合は `SANITIZE_CONFIG.ALLOWED_TAGS` 拡張不足として fail (#1717 致命欠陥再発防止)
//
// PR #1717 で発覚した欠陥（DOMPurify ALLOWED_TAGS が
// ['strong','em','a','br','span','sup','sub','small','b','i'] のみで legal docs の
// h1/h2/p/ul/ol/li/div/table が全て strip）を、CI で「シナリオを実行する前」に検出する。
//
// E2E (tests/e2e/lp-innerhtml-structure.spec.ts) と相補的:
//   - 静的検査 (本スクリプト): 高速 (~ 数秒)、毎 PR 実行可能、fail を即時検出
//   - E2E: 実機 chromium で実 DOMPurify 動作確認、最終保証
//
// 使い方: node scripts/check-lp-innerhtml-tags.mjs
//        npm run check:lp-innerhtml-tags  (package.json 経由)

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const SHARED_LABELS_PATH = resolve('site/shared-labels.js');

// #1750 AC2: 致命欠陥再発防止のため、必須 E2E spec ファイルの存在を CI で hard-fail で検証する。
// 過去に PR #1717 で「force push により E2E spec / SANITIZE 拡張がまるごと消失」する事故が発生した。
// 一度追加したら削除されないことを構造的に保証する（ADR-0026 多層防御の B 層）。
const REQUIRED_E2E_SPECS = [
	'tests/e2e/lp-legal-docs-render.spec.ts',
	'tests/e2e/lp-innerhtml-structure.spec.ts',
];

function checkRequiredE2eSpecs() {
	const missing = REQUIRED_E2E_SPECS.filter((p) => !existsSync(resolve(p)));
	if (missing.length > 0) {
		console.error(
			`\n[FAIL] ${missing.length} 個の必須 E2E spec が消失しています (#1750 AC2 / ADR-0026 force push 防止):`,
		);
		for (const p of missing) {
			console.error(`  - ${p}`);
		}
		console.error('\n[hint] PR #1717 同様の事故 (force push による致命修正消失) を防ぐため、');
		console.error(
			'       これらの spec は一度追加されたら削除禁止。誤って削除した場合は復元してください。',
		);
		process.exit(1);
	}
	console.log(`[OK] All ${REQUIRED_E2E_SPECS.length} required E2E specs exist.`);
}

// shared-labels.js / applyLpKeys() の SANITIZE_CONFIG と完全一致させる SSOT (#1717 fix 後)
const SANITIZE_CONFIG = {
	ALLOWED_TAGS: [
		'strong',
		'em',
		'a',
		'br',
		'span',
		'sup',
		'sub',
		'small',
		'b',
		'i',
		'h1',
		'h2',
		'h3',
		'h4',
		'p',
		'ul',
		'ol',
		'li',
		'div',
		'table',
		'tr',
		'th',
		'td',
		'thead',
		'tbody',
		'code',
		'header',
		'section',
		'dl',
		'dt',
		'dd',
		'figure',
		'figcaption',
	],
	ALLOWED_ATTR: [
		'href',
		'target',
		'rel',
		'class',
		'aria-hidden',
		'aria-label',
		'id',
		'data-contact-context',
	],
	ALLOW_DATA_ATTR: false,
	ALLOW_UNKNOWN_PROTOCOLS: false,
	ADD_ATTR: ['target'],
};

// 構造タグ（strip された場合 fail とするタグ）
const STRUCTURE_TAGS = [
	'h1',
	'h2',
	'h3',
	'h4',
	'p',
	'ul',
	'ol',
	'li',
	'div',
	'table',
	'tr',
	'th',
	'td',
	'thead',
	'tbody',
	'header',
	'section',
	'dl',
	'dt',
	'dd',
];

// テーブル行を含む値は XHTML パーサが必要（applyLpKeys と同じ判定）
function needsXhtmlParse(value) {
	return /^\s*<(tr|thead|tbody|th|td)\b/i.test(value);
}

function normalizeVoidElements(html) {
	return html
		.replace(/<br(\s[^>]*?)?>/gi, '<br$1/>')
		.replace(/<hr(\s[^>]*?)?>/gi, '<hr$1/>')
		.replace(/<img(\s[^>]*?)?>/gi, '<img$1/>');
}

function countTagsInHtml(html, tagName) {
	const re = new RegExp(`<${tagName}(\\s[^>]*)?>`, 'gi');
	return (html.match(re) || []).length;
}

/**
 * 文字列から `const LP_LABELS = { ... };` の開始 `{` 位置と直後の `;` 直前の `}` 位置を、
 * brace counter + string-context aware で探す。
 */
function findMatchingBrace(src, objStart) {
	let depth = 0;
	let inString = false;
	let strChar = '';
	let escaped = false;
	for (let i = objStart; i < src.length; i++) {
		const c = src[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (inString) {
			if (c === '\\') escaped = true;
			else if (c === strChar) inString = false;
			continue;
		}
		if (c === '"' || c === "'") {
			inString = true;
			strChar = c;
			continue;
		}
		if (c === '{') depth++;
		else if (c === '}' && --depth === 0) return i;
	}
	return -1;
}

/**
 * shared-labels.js から `const LP_LABELS = { ... };` ブロックを抽出して JSON.parse する。
 * generate-lp-labels.mjs が key/value 共に "..." quoted の正しい JSON 構造で出力するため、
 * 開始 `{` から対応する閉じ `};` まで brace カウントで切り出して JSON.parse できる。
 */
function loadLpLabels() {
	const src = readFileSync(SHARED_LABELS_PATH, 'utf8');
	const startMarker = 'const LP_LABELS = ';
	const startIdx = src.indexOf(startMarker);
	if (startIdx < 0) {
		throw new Error('Could not locate `const LP_LABELS = ` in shared-labels.js');
	}
	const objStart = startIdx + startMarker.length;
	if (src[objStart] !== '{') {
		throw new Error('Expected `{` after `const LP_LABELS = `');
	}
	const endIdx = findMatchingBrace(src, objStart);
	if (endIdx < 0) {
		throw new Error('Unterminated `const LP_LABELS` block in shared-labels.js');
	}
	return JSON.parse(src.slice(objStart, endIdx + 1));
}

function checkValue(namespace, key, value) {
	if (typeof value !== 'string') return null;
	// 構造タグを含まない単純文字列は早期スキップ
	if (!/<\w+/.test(value)) return null;

	const window = new JSDOM('').window;
	const DOMPurify = createDOMPurify(window);

	const xhtml = needsXhtmlParse(value);
	const input = xhtml ? normalizeVoidElements(value) : value;
	const cfg = xhtml
		? Object.assign({}, SANITIZE_CONFIG, { PARSER_MEDIA_TYPE: 'application/xhtml+xml' })
		: SANITIZE_CONFIG;
	const sanitized = DOMPurify.sanitize(input, cfg);

	const issues = [];
	for (const tag of STRUCTURE_TAGS) {
		const before = countTagsInHtml(input, tag);
		const after = countTagsInHtml(sanitized, tag);
		if (before > 0 && after < before) {
			issues.push({ tag, before, after });
		}
	}
	return issues.length > 0 ? { namespace, key, issues, sanitized, original: value } : null;
}

function main() {
	// #1750 AC2: 必須 E2E spec の存在確認を最初に実行（force push 防止の B 層）
	console.log('[check-lp-innerhtml-tags] Verifying required E2E specs...');
	checkRequiredE2eSpecs();

	console.log('[check-lp-innerhtml-tags] Loading shared-labels.js...');
	const labels = loadLpLabels();

	const findings = [];
	for (const [namespace, section] of Object.entries(labels)) {
		if (!section || typeof section !== 'object') continue;
		for (const [key, value] of Object.entries(section)) {
			const finding = checkValue(namespace, key, value);
			if (finding) findings.push(finding);
		}
	}

	if (findings.length > 0) {
		console.error(
			`\n[FAIL] ${findings.length} 個のラベルで DOMPurify 通過後に構造タグが strip されました:\n`,
		);
		for (const f of findings) {
			console.error(`  - ${f.namespace}.${f.key}`);
			for (const issue of f.issues) {
				console.error(`      <${issue.tag}>: ${issue.before} → ${issue.after}`);
			}
			console.error(`      original  : ${f.original.slice(0, 120)}...`);
			console.error(`      sanitized : ${f.sanitized.slice(0, 120)}...\n`);
		}
		console.error('[hint] SANITIZE_CONFIG.ALLOWED_TAGS が不足している可能性があります。');
		console.error('       site/shared-labels.js の applyLpKeys() を確認してください (ADR-0025)。');
		process.exit(1);
	}

	console.log('[OK] All LP labels pass DOMPurify SANITIZE_CONFIG without losing structure tags.');
	process.exit(0);
}

main();
