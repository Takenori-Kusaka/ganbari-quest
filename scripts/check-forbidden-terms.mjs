#!/usr/bin/env node
/**
 * scripts/check-forbidden-terms.mjs (#565)
 *
 * 並行実装間の用語同期漏れを防ぐため、禁止語（旧用語・非推奨表記）が残っていないか検証する。
 *
 * 使用法:
 *   node scripts/check-forbidden-terms.mjs
 *
 * CI で実行する想定。エラー時は exit 1。
 *
 * 禁止語の追加: FORBIDDEN_TERMS 配列に追加する。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * 禁止語一覧
 * - term: 検出対象文字列
 * - reason: なぜ禁止か
 * - replacement: 置換推奨語（任意）
 */
const FORBIDDEN_TERMS = [
	{
		term: 'ようちえん',
		reason: '#537 年齢区分再設計で「幼児」に統一',
		replacement: 'ようじ / 幼児',
	},
	{
		term: 'ようちえんキッズ',
		reason: '#561 LP年齢区分統一で「ようじキッズ」に変更',
		replacement: 'ようじキッズ',
	},
	{
		term: 'プレミアムプラン',
		reason: 'プラン用語統一規約（docs/design/21）でスタンダードプランに統一',
		replacement: 'スタンダードプラン',
	},
	{
		term: 'ベーシックプラン',
		reason: 'プラン用語統一規約（docs/design/21）で無料プランに統一',
		replacement: '無料プラン',
	},
];

/**
 * 検索対象ディレクトリとファイル拡張子
 */
const SEARCH_ROOTS = ['src', 'site', 'docs/design', 'static'];

const SEARCH_EXTENSIONS = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.mjs',
	'.svelte',
	'.html',
	'.md',
	'.json',
	'.yml',
	'.yaml',
]);

const EXCLUDE_DIRS = new Set([
	'node_modules',
	'.svelte-kit',
	'build',
	'dist',
	'coverage',
	'test-results',
	'playwright-report',
]);

/**
 * 禁止語検出を除外したいファイル（例: 禁止語リスト自体を含むスクリプト）
 */
const EXCLUDE_FILES = new Set([
	'scripts/check-forbidden-terms.mjs',
	// parallel-implementations.md は歴史的経緯として旧用語に言及
	'docs/design/parallel-implementations.md',
	// プラン用語統一規約自体は禁止語を定義しているため除外
	'docs/design/21-プラン用語統一規約.md',
]);

function* walkFiles(dir) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (EXCLUDE_DIRS.has(entry.name)) continue;
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkFiles(fullPath);
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name);
			if (SEARCH_EXTENSIONS.has(ext)) {
				yield fullPath;
			}
		}
	}
}

function main() {
	console.log('=== 禁止語チェック ===\n');

	const violations = [];

	for (const root of SEARCH_ROOTS) {
		const rootPath = path.join(REPO_ROOT, root);
		if (!fs.existsSync(rootPath)) continue;

		for (const filePath of walkFiles(rootPath)) {
			const relPath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
			if (EXCLUDE_FILES.has(relPath)) continue;

			const content = fs.readFileSync(filePath, 'utf-8');
			const lines = content.split('\n');

			for (const { term, reason, replacement } of FORBIDDEN_TERMS) {
				lines.forEach((line, idx) => {
					if (line.includes(term)) {
						violations.push({
							file: relPath,
							line: idx + 1,
							term,
							reason,
							replacement,
							snippet: line.trim().slice(0, 120),
						});
					}
				});
			}
		}
	}

	if (violations.length === 0) {
		console.log('✓ 禁止語は見つかりませんでした');
		process.exit(0);
	}

	console.error(`✗ ${violations.length} 件の禁止語が見つかりました:\n`);
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}`);
		console.error(`    禁止語: "${v.term}"`);
		console.error(`    理由: ${v.reason}`);
		if (v.replacement) console.error(`    推奨: ${v.replacement}`);
		console.error(`    該当行: ${v.snippet}`);
		console.error('');
	}

	process.exit(1);
}

main();
