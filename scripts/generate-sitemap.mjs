#!/usr/bin/env node

/**
 * scripts/generate-sitemap.mjs (#1908)
 *
 * LP `site/sitemap.xml` を `site/**.html` を走査して自動生成する。
 *
 * **背景** (#1908): 手動編集時代は `faq.html` / `graduation.html` / `help/license-key.html`
 * が長期間欠落 (`<lastmod>` 2026-04-11 のまま) し、検索エンジンが新ページを
 * クロールできなかった。pages.yml の build step に組み込み、main push 毎に
 * 自動再生成することで stale を構造的に解消する。
 *
 * **設計方針** (Issue #1908):
 *   - `site/*.html` + `site/help/*.html` を glob で網羅
 *   - 各 HTML の `<lastmod>` は `git log -1 --format=%aI <path>` で取得
 *   - `<priority>` / `<changefreq>` は path prefix からルール表で割当
 *   - 出力は site/sitemap.xml を上書き (手動編集禁止コメント付き)
 *
 * **OSS 調査** (#1350 / ADR-0014):
 *   - sitemap-generator-cli: Web スクレイピング型で http サーバ起動必要、Pre-PMF 過剰
 *   - sitemap (npm 200KB): XML stream API。file 列挙ロジックは別途必要、利点薄い
 *   - **採用: 独自実装** — fs.readdirSync + child_process(git log) で zero-dep
 *
 * **使用法**:
 *   node scripts/generate-sitemap.mjs              # site/sitemap.xml 上書き
 *   node scripts/generate-sitemap.mjs --check      # diff 検査 (CI/pre-ready 用)
 *   node scripts/generate-sitemap.mjs --dry-run    # stdout 出力のみ (ファイル書出しなし)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SITE_DIR = path.join(REPO_ROOT, 'site');
const OUTPUT_PATH = path.join(SITE_DIR, 'sitemap.xml');
const BASE_URL = 'https://www.ganbari-quest.com';

/**
 * URL prefix → priority/changefreq ルール表。
 * 配列順で最初に match した entry を採用する (top-down resolve)。
 *
 * @type {Array<{match: (url: string) => boolean, priority: string, changefreq: string}>}
 */
const PRIORITY_RULES = [
	{ match: (/** @type {string} */ url) => url === '/', priority: '1.0', changefreq: 'weekly' },
	{
		match: (/** @type {string} */ url) => url === '/pricing.html',
		priority: '0.9',
		changefreq: 'monthly',
	},
	{
		match: (/** @type {string} */ url) => url === '/faq.html',
		priority: '0.8',
		changefreq: 'monthly',
	},
	{
		match: (/** @type {string} */ url) => url === '/graduation.html',
		priority: '0.8',
		changefreq: 'monthly',
	},
	{
		match: (/** @type {string} */ url) => url === '/pamphlet.html',
		priority: '0.7',
		changefreq: 'monthly',
	},
	{
		match: (/** @type {string} */ url) => url === '/selfhost.html',
		priority: '0.6',
		changefreq: 'monthly',
	},
	{
		match: (/** @type {string} */ url) => url.startsWith('/help/'),
		priority: '0.5',
		changefreq: 'monthly',
	},
	{ match: () => true, priority: '0.4', changefreq: 'yearly' }, // terms / privacy / tokushoho / sla 等
];

/**
 * site/ 配下の HTML ファイルを再帰列挙し、URL path 配列を返す。
 * `index.html` は `/` に正規化、subdir も含める。
 *
 * @param {string} dir 走査ルート (絶対パス)
 * @param {string} prefix URL prefix (再帰用、通常は呼出側 '')
 * @returns {string[]} URL path 配列 (例: ['/', '/faq.html', '/help/license-key.html'])
 */
export function collectHtmlFiles(dir, prefix = '') {
	const result = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			// screenshots / assets 等の非 HTML ディレクトリは scan 対象だが HTML 以外しか含まない
			result.push(...collectHtmlFiles(fullPath, `${prefix}/${entry.name}`));
		} else if (entry.isFile() && entry.name.endsWith('.html')) {
			if (entry.name === 'index.html' && prefix === '') {
				result.push('/');
			} else if (entry.name === 'index.html') {
				result.push(`${prefix}/`);
			} else {
				result.push(`${prefix}/${entry.name}`);
			}
		}
	}
	return result.sort();
}

/**
 * git log -1 --format=%aI <path> で最終変更日 ISO8601 を取得。
 * git log が空 (未 commit ファイル) または失敗時は今日の YYYY-MM-DD を返す fallback。
 *
 * @param {string} absolutePath
 * @returns {string} YYYY-MM-DD 形式
 */
export function getLastModDate(absolutePath) {
	const result = spawnSync('git', ['log', '-1', '--format=%aI', absolutePath], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
	});
	if (result.status !== 0 || !result.stdout.trim()) {
		// 未 commit / git 外環境 fallback
		return new Date().toISOString().slice(0, 10);
	}
	// '2026-05-09T18:30:17+09:00' → '2026-05-09'
	return result.stdout.trim().slice(0, 10);
}

/**
 * URL path → priority/changefreq の解決。PRIORITY_RULES を top-down で評価。
 *
 * @param {string} url
 * @returns {{priority: string, changefreq: string}}
 */
export function resolvePriority(url) {
	for (const rule of PRIORITY_RULES) {
		if (rule.match(url)) {
			return { priority: rule.priority, changefreq: rule.changefreq };
		}
	}
	// 設計上 PRIORITY_RULES 末尾が catch-all だがフォールバック保証
	return { priority: '0.4', changefreq: 'yearly' };
}

/**
 * sitemap.xml 文字列を生成 (副作用なし、テスト容易性のため pure)。
 *
 * @param {Array<{url: string, lastmod: string, priority: string, changefreq: string}>} entries
 * @returns {string}
 */
export function buildSitemapXml(entries) {
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!-- 自動生成: scripts/generate-sitemap.mjs (#1908)。手動編集禁止。pages.yml で main push 毎に再生成される。 -->',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
	];
	for (const entry of entries) {
		lines.push('  <url>');
		lines.push(`    <loc>${BASE_URL}${entry.url}</loc>`);
		lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
		lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
		lines.push(`    <priority>${entry.priority}</priority>`);
		lines.push('  </url>');
	}
	lines.push('</urlset>');
	lines.push('');
	return lines.join('\n');
}

/**
 * site/ 全 HTML を走査して sitemap entry 配列を構築 (副作用なし、テスト容易性のため pure)。
 *
 * @param {string} siteDir SITE_DIR を上書き可 (テスト用)
 * @returns {Array<{url: string, lastmod: string, priority: string, changefreq: string}>}
 */
export function generateEntries(siteDir = SITE_DIR) {
	const urls = collectHtmlFiles(siteDir);
	return urls.map((url) => {
		const relPath = url === '/' ? 'index.html' : url.replace(/^\//, '');
		const absolutePath = path.join(siteDir, relPath);
		const lastmod = getLastModDate(absolutePath);
		const { priority, changefreq } = resolvePriority(url);
		return { url, lastmod, priority, changefreq };
	});
}

// ────────────── CLI ────────────── //

function main() {
	const argv = process.argv.slice(2);
	const isCheck = argv.includes('--check');
	const isDryRun = argv.includes('--dry-run');

	const entries = generateEntries();
	const xml = buildSitemapXml(entries);

	if (isDryRun) {
		process.stdout.write(xml);
		return;
	}

	if (isCheck) {
		const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : '';
		if (current !== xml) {
			console.error('[generate-sitemap] site/sitemap.xml is out of date.');
			console.error('[generate-sitemap] Run: node scripts/generate-sitemap.mjs');
			process.exit(1);
		}
		console.log('[generate-sitemap] site/sitemap.xml is up to date.');
		return;
	}

	fs.writeFileSync(OUTPUT_PATH, xml);
	console.log(
		`[generate-sitemap] Wrote ${entries.length} URLs to ${path.relative(REPO_ROOT, OUTPUT_PATH)}`,
	);
}

// ESM の直接実行判定 (import 経由ではテスト時 main() を呼ばない)
const entryArg = process.argv[1] ?? '';
const isDirectRun =
	import.meta.url === `file://${entryArg.replace(/\\/g, '/')}` ||
	import.meta.url.endsWith(path.basename(entryArg));
if (isDirectRun) {
	main();
}
