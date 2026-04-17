#!/usr/bin/env node
/**
 * lint-color-classes.mjs
 *
 * Tailwind デフォルトカラークラスの直接使用を検出する lint スクリプト。
 * @theme で上書き済みだが、新規コードでは CSS 変数の直接使用を推奨。
 *
 * 対象: src/routes/, src/lib/features/ 内の .svelte ファイル
 * 除外: src/lib/ui/styles/ (デザイントークン定義層)
 *
 * Usage: node scripts/lint-color-classes.mjs [--error]
 *   --error: 違反があった場合に exit code 1 で終了（CI用）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/routes', 'src/lib/features'];
const IGNORE_DIRS = ['node_modules', '.svelte-kit', 'build'];
const IS_ERROR_MODE = process.argv.includes('--error');

// Tailwind デフォルトカラー名（@theme で上書き済み or 禁止対象）
// bg-white, text-white, bg-black, text-black は許容（固定色）
const COLOR_NAMES = [
	'red',
	'orange',
	'amber',
	'yellow',
	'lime',
	'green',
	'emerald',
	'teal',
	'cyan',
	'sky',
	'blue',
	'indigo',
	'violet',
	'purple',
	'fuchsia',
	'pink',
	'rose',
	'gray',
	'slate',
	'zinc',
	'neutral',
	'stone',
];

// クラスプレフィックス
const PREFIXES = [
	'bg',
	'text',
	'border',
	'ring',
	'outline',
	'divide',
	'from',
	'via',
	'to',
	'decoration',
	'accent',
	'caret',
	'fill',
	'stroke',
	'shadow',
	'placeholder',
];

// パターン: bg-blue-500, text-gray-700, hover:bg-red-100 等
// (?:^|[\s"'`{]) でクラス境界を検出
const colorPattern = new RegExp(
	`(?:^|[\\s"'\`{:])(?:hover:|focus:|active:|group-hover:|dark:|disabled:)*(?:${PREFIXES.join('|')})-(?:${COLOR_NAMES.join('|')})-(?:\\d{2,3})(?=[\\s"'\`}>]|$)`,
	'g',
);

// hex arbitrary value: bg-[#xxx], text-[#xxx] 等
const hexArbitraryPattern = new RegExp(`(?:${PREFIXES.join('|')})-\\[#[0-9a-fA-F]{3,8}\\]`, 'g');

// <style> ブロック内の hex カラー直書き: color: #xxx, background: #xxx 等
// CSS プロパティ値としての hex を検出（@theme 定義層は除外済み）
const cssHexPattern = /#[0-9a-fA-F]{3,8}(?=[;\s,)])/g;

function collectFiles(dir, ext) {
	const results = [];
	try {
		const entries = readdirSync(dir);
		for (const entry of entries) {
			const fullPath = join(dir, entry);
			if (IGNORE_DIRS.some((ig) => fullPath.includes(ig))) continue;
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				results.push(...collectFiles(fullPath, ext));
			} else if (entry.endsWith(ext)) {
				results.push(fullPath);
			}
		}
	} catch {
		// directory doesn't exist
	}
	return results;
}

let totalViolations = 0;
const violations = [];

for (const scanDir of SCAN_DIRS) {
	const files = collectFiles(join(ROOT, scanDir), '.svelte');

	for (const filePath of files) {
		const content = readFileSync(filePath, 'utf-8');
		const lines = content.split('\n');
		const relPath = relative(ROOT, filePath).replace(/\\/g, '/');
		const fileViolations = [];

		// Track whether we're inside a <style> block
		let inStyle = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNum = i + 1;

			// Track <style> block boundaries
			if (/<style[^>]*>/.test(line)) inStyle = true;
			if (/<\/style>/.test(line)) {
				inStyle = false;
				continue;
			}

			// Check for Tailwind default color classes (template area)
			if (!inStyle) {
				const colorMatches = line.matchAll(colorPattern);
				for (const match of colorMatches) {
					const cls = match[0].trim().replace(/^["'`{:]/, '');
					fileViolations.push({
						line: lineNum,
						type: 'tailwind-color',
						match: cls,
						suggestion: `CSS変数を使用: bg-[var(--color-*)] / text-[var(--color-*)]`,
					});
				}

				// Check for hex arbitrary values (template area)
				const hexMatches = line.matchAll(hexArbitraryPattern);
				for (const match of hexMatches) {
					fileViolations.push({
						line: lineNum,
						type: 'hex-arbitrary',
						match: match[0],
						suggestion: `hex 禁止。CSS変数を使用: bg-[var(--color-*)]`,
					});
				}
			}

			// Check for hex in <style> blocks
			if (inStyle) {
				// Skip CSS comment lines
				if (line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
				const styleHexMatches = line.matchAll(cssHexPattern);
				for (const match of styleHexMatches) {
					fileViolations.push({
						line: lineNum,
						type: 'style-hex',
						match: match[0],
						suggestion: `<style>内の hex 禁止。CSS変数 var(--color-*) を使用`,
					});
				}
			}
		}

		if (fileViolations.length > 0) {
			totalViolations += fileViolations.length;
			violations.push({ file: relPath, items: fileViolations });
		}
	}
}

// Output
if (violations.length === 0) {
	console.log('✅ Tailwind デフォルトカラークラスの違反なし');
	process.exit(0);
}

console.log(
	`\n⚠️  Tailwind デフォルトカラークラス検出: ${totalViolations} 件 (${violations.length} ファイル)\n`,
);
console.log('注: @theme でブランドカラーに上書き済みのため既存は動作しますが、');
console.log('   新規コードでは CSS 変数 (var(--color-*)) の直接使用を推奨します。\n');

for (const { file, items } of violations) {
	console.log(`📄 ${file}`);
	for (const item of items) {
		const icon = item.type === 'hex-arbitrary' || item.type === 'style-hex' ? '🔴' : '🟡';
		console.log(`  ${icon} L${item.line}: ${item.match}`);
		if (item.type !== 'tailwind-color') {
			console.log(`     → ${item.suggestion}`);
		}
	}
	console.log();
}

console.log(`合計: ${totalViolations} 件`);
console.log(`  🟡 Tailwind カラークラス: 推奨レベル（@theme で上書き済み）`);
console.log(`  🔴 hex arbitrary value / <style> 内 hex: 禁止（CSS変数必須）\n`);

// hex arbitrary + style-hex は常にエラー、Tailwind カラーは --error フラグ時のみ
const hardErrors = violations.reduce(
	(sum, v) =>
		sum + v.items.filter((i) => i.type === 'hex-arbitrary' || i.type === 'style-hex').length,
	0,
);

if (hardErrors > 0) {
	console.log(`❌ hex 直書き: ${hardErrors} 件 — 修正必須`);
	process.exit(1);
}

if (IS_ERROR_MODE) {
	console.log(`❌ --error モード: ${totalViolations} 件の違反があります`);
	process.exit(1);
}
