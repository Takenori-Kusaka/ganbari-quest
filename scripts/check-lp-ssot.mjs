#!/usr/bin/env node
/**
 * check-lp-ssot.mjs — Issue #1465 Phase A
 *
 * site/**​/*.html の日本語ハードコードを検査する。
 * baseline より増加した場合は exit 1。
 *
 * 違反 = 日本語テキストを含む行のうち、以下のどれも持たない行:
 *   - data-lp-key=     (LP コンテンツ SSOT 属性)
 *   - data-label=      (age-tier / plan ラベル SSOT 属性)
 *   - data-age-tier=   (age-tier コンテナ)
 *
 * 免除ライン:
 *   - <style>...</style> ブロック内
 *   - <script>...</script> ブロック内 (JSON-LD 含む)
 *   - HTML コメント <!-- ... -->
 *   - <meta ... > タグ行
 *   - 可視テキスト（タグ除去後）に日本語がない行（alt=等のみ）
 *
 * Usage: node scripts/check-lp-ssot.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const baselineFile = join(__dirname, 'lp-ssot-baseline.json');

const baseline = JSON.parse(readFileSync(baselineFile, 'utf-8'));
const { count: baselineCount } = baseline;

const JP_REGEX = /[぀-ヿ一-龯㐀-䶿＀-￯]/;

function hasSsotAttribute(line) {
	return /data-lp-key=/.test(line) || /data-label=/.test(line) || /data-age-tier=/.test(line);
}

function hasVisibleJpText(line) {
	const textOnly = line.replace(/<[^>]+>/g, '').trim();
	return JP_REGEX.test(textOnly);
}

function updateBlockState(line, state) {
	let { inStyle, inScript, inComment } = state;

	if (!inStyle && !inScript && line.includes('<style')) {
		inStyle = true;
	}
	if (inStyle && line.includes('</style>')) {
		return { inStyle: false, inScript, inComment, skip: true };
	}
	if (inStyle) {
		return { inStyle, inScript, inComment, skip: true };
	}

	if (!inScript && line.includes('<script')) {
		inScript = true;
	}
	if (inScript && line.includes('</script>')) {
		return { inStyle, inScript: false, inComment, skip: true };
	}
	if (inScript) {
		return { inStyle, inScript, inComment, skip: true };
	}

	if (!inComment && line.includes('<!--')) {
		inComment = true;
	}
	if (inComment && line.includes('-->')) {
		return { inStyle, inScript, inComment: false, skip: true };
	}
	if (inComment) {
		return { inStyle, inScript, inComment, skip: true };
	}

	return { inStyle, inScript, inComment, skip: false };
}

function isViolationLine(line) {
	if (/^<meta\s/.test(line)) {
		return false;
	}
	if (!JP_REGEX.test(line)) {
		return false;
	}
	if (hasSsotAttribute(line)) {
		return false;
	}
	return hasVisibleJpText(line);
}

function checkHtmlFile(filePath) {
	const src = readFileSync(filePath, 'utf-8');
	const lines = src.split('\n');
	let state = { inStyle: false, inScript: false, inComment: false };
	let violations = 0;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		state = updateBlockState(line, state);
		if (state.skip) {
			continue;
		}
		if (isViolationLine(line)) {
			violations++;
		}
	}

	return violations;
}

function collectHtmlFiles(dir) {
	const result = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			result.push(...collectHtmlFiles(full));
		} else if (entry.isFile() && entry.name.endsWith('.html')) {
			result.push(full);
		}
	}
	return result;
}

const siteDir = join(root, 'site');
const htmlFiles = collectHtmlFiles(siteDir);

let totalCount = 0;
const violationFiles = [];

for (const file of htmlFiles) {
	const count = checkHtmlFile(file);
	if (count > 0) {
		violationFiles.push({
			file: file.replace(`${root}${process.platform === 'win32' ? '\\' : '/'}`, ''),
			count,
		});
		totalCount += count;
	}
}

console.log(`[LP-SSOT] Hardcoded JP text violations: ${totalCount} (baseline: ${baselineCount})`);

if (totalCount > baselineCount) {
	console.error(
		`\nERROR [LP-SSOT]: Hardcoded JP text count increased by ${totalCount - baselineCount} since baseline.`,
	);
	console.error(
		'Add data-lp-key attributes and define text in src/lib/domain/labels.ts LP_* constants.',
	);
	console.error('Update scripts/lp-ssot-baseline.json only when REDUCING the count.');
	if (violationFiles.length > 0) {
		console.error('Violation files:');
		for (const { file, count } of violationFiles) {
			console.error(`  ${file}: ${count} violation(s)`);
		}
	}
	process.exit(1);
}

if (totalCount < baselineCount) {
	console.log(
		`\n[LP-SSOT] Great! Count reduced by ${baselineCount - totalCount}. Consider updating the baseline.`,
	);
}

console.log('OK: LP SSOT counts are within baseline.');
