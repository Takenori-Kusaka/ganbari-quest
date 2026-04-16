#!/usr/bin/env node
/**
 * scripts/check-site-html.mjs (#710)
 *
 * site/ ディレクトリの静的HTMLファイルを検証する。
 * - 内部リンクの整合性（site/ 内のファイル参照が正しいか）
 * - フッター共通要素の一貫性（全ページに必要な要素が存在するか）
 * - mailto リンクの一貫性
 *
 * CI で実行する想定。エラー時は exit 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SITE_DIR = path.join(REPO_ROOT, 'site');

/** site/ 内の HTML ファイルを取得 */
function getSiteHtmlFiles() {
	if (!fs.existsSync(SITE_DIR)) return [];
	return fs
		.readdirSync(SITE_DIR)
		.filter((f) => f.endsWith('.html'))
		.map((f) => path.join(SITE_DIR, f));
}

/** site/ 内の相対リンクを検証 */
function checkInternalLinks(filePath, content) {
	const violations = [];
	const relPath = path.relative(REPO_ROOT, filePath);

	// href="xxx.html" パターンを検出（外部URL・アンカー・mailto・tel を除外）
	const linkPattern = /href="([^"#]+\.html)"/g;
	for (const match of content.matchAll(linkPattern)) {
		const linked = match[1];
		// 外部URLはスキップ
		if (linked.startsWith('http://') || linked.startsWith('https://')) continue;
		// site/ 内のファイル存在チェック
		const linkedPath = path.resolve(path.dirname(filePath), linked);
		if (!fs.existsSync(linkedPath)) {
			violations.push({
				file: relPath,
				issue: `壊れた内部リンク: "${linked}" が存在しません`,
				line: content.substring(0, match.index).split('\n').length,
			});
		}
	}
	return violations;
}

/** 全 site/ HTML で共通して必要な要素をチェック */
function checkRequiredElements(filePath, content) {
	const violations = [];
	const relPath = path.relative(REPO_ROOT, filePath);
	const fileName = path.basename(filePath);

	// pamphlet は別構造のため一部チェックをスキップ
	if (fileName === 'pamphlet.html') return violations;

	// フッターに正しい問い合わせリンクが存在するか
	if (!content.includes('mailto:ganbari.quest.support@gmail.com')) {
		violations.push({
			file: relPath,
			issue: '問い合わせ用メールリンクがありません（mailto:ganbari.quest.support@gmail.com）',
		});
	}

	return violations;
}

function main() {
	console.log('=== site/ HTML 検証 ===\n');

	const files = getSiteHtmlFiles();
	if (files.length === 0) {
		console.log('site/ に HTML ファイルがありません。スキップ。');
		process.exit(0);
	}

	const errors = [];

	for (const filePath of files) {
		const content = fs.readFileSync(filePath, 'utf-8');
		errors.push(...checkInternalLinks(filePath, content));
		errors.push(...checkRequiredElements(filePath, content));
	}

	if (errors.length === 0) {
		console.log(`✓ ${files.length} ファイルを検証。エラーなし。`);
		process.exit(0);
	}

	console.error(`✗ ${errors.length} 件のエラーが見つかりました:\n`);
	for (const v of errors) {
		const lineInfo = v.line ? `:${v.line}` : '';
		console.error(`  ${v.file}${lineInfo}`);
		console.error(`    ${v.issue}`);
		console.error('');
	}

	process.exit(1);
}

main();
