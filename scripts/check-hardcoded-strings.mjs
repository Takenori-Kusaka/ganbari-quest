#!/usr/bin/env node
/**
 * check-hardcoded-strings.mjs — Issue #1452 Phase A / #1464 Phase D
 *
 * 1. ESLint (no-hardcoded-jp-text) で src/routes/**​/*.svelte を検査
 * 2. site/*.html の日本語ハードコードを独自パーサで検査
 *
 * いずれも baseline より増加した場合は exit 1。
 *
 * Usage: node scripts/check-hardcoded-strings.mjs
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const baselineFile = join(__dirname, 'hardcoded-strings-baseline.json');

const baseline = JSON.parse(readFileSync(baselineFile, 'utf-8'));
const { count: baselineCount, rule, htmlCount: baselineHtmlCount = null } = baseline;

// =====================================================================
// 1. Svelte チェック (ESLint)
// =====================================================================

const eslintBin = join(root, 'node_modules', '.bin', 'eslint');

let eslintOutput = '';
try {
	eslintOutput = execSync(`"${eslintBin}" --format json "src/routes/**/*.svelte"`, {
		encoding: 'utf-8',
		cwd: root,
		maxBuffer: 64 * 1024 * 1024,
	});
} catch (e) {
	const stdout = e.stdout;
	eslintOutput = typeof stdout === 'string' ? stdout : stdout ? stdout.toString('utf-8') : '';
}

let eslintResults;
try {
	eslintResults = JSON.parse(eslintOutput);
} catch {
	console.error('Failed to parse ESLint JSON output.');
	process.exit(1);
}

let svelteCount = 0;
for (const file of eslintResults) {
	for (const msg of file.messages) {
		if (msg.ruleId === rule) {
			svelteCount++;
		}
	}
}

// =====================================================================
// 2. HTML チェック (site/*.html)
//
// 違反 = 日本語テキストを含む行のうち、以下のどれも持たない行:
//   - data-lp-key=     (LP コンテンツ SSOT 属性)
//   - data-label=      (age-tier / plan ラベル SSOT 属性)
//   - data-age-tier=   (age-tier コンテナ、子に data-label を持つ)
//
// 免除ライン:
//   - <style>...</style> ブロック内
//   - <script>...</script> ブロック内 (JSON-LD 含む)
//   - HTML コメント <!-- ... -->
//   - <meta ... > タグ行
//   - 可視テキスト（タグ除去後）に日本語がない行（alt=等のみ）
// =====================================================================

const JP_REGEX = /[぀-ヿ一-龯㐀-䶿＀-￯]/;

/** SSOT 属性チェック */
function hasSsotAttribute(line) {
	return /data-lp-key=/.test(line) || /data-label=/.test(line) || /data-age-tier=/.test(line);
}

/** タグを除いた可視テキストに日本語があるか */
function hasVisibleJpText(line) {
	const textOnly = line.replace(/<[^>]+>/g, '').trim();
	return JP_REGEX.test(textOnly);
}

/** ブロック境界更新を適用し次のブロック状態を返す */
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

/** HTML ファイルの違反行を判定する（1 行分） */
function isHtmlViolationLine(line) {
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

/**
 * HTML ファイル 1 件の違反行数を返す
 */
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
		if (isHtmlViolationLine(line)) {
			violations++;
		}
	}

	return violations;
}

const siteDir = join(root, 'site');
const htmlFiles = readdirSync(siteDir)
	.filter((f) => f.endsWith('.html'))
	.map((f) => join(siteDir, f));

let htmlCount = 0;
const htmlViolationFiles = [];
for (const file of htmlFiles) {
	const count = checkHtmlFile(file);
	if (count > 0) {
		htmlViolationFiles.push({ file: file.replace(`${root}/`, ''), count });
		htmlCount += count;
	}
}

// =====================================================================
// 3. 結果表示とゲート判定
// =====================================================================

console.log(`[Svelte] Hardcoded JP text violations: ${svelteCount} (baseline: ${baselineCount})`);
console.log(
	`[HTML]   Hardcoded JP text violations: ${htmlCount} (baseline: ${baselineHtmlCount ?? 'not set'})`,
);

let failed = false;

if (svelteCount > baselineCount) {
	console.error(
		`\nERROR [Svelte]: Hardcoded JP text count increased by ${svelteCount - baselineCount} since baseline.`,
	);
	console.error('Use constants from $lib/domain/labels.ts instead of inline Japanese text.');
	console.error('Update scripts/hardcoded-strings-baseline.json only when REDUCING the count.');
	failed = true;
}

if (baselineHtmlCount !== null && htmlCount > baselineHtmlCount) {
	console.error(
		`\nERROR [HTML]: Hardcoded JP text count increased by ${htmlCount - baselineHtmlCount} since baseline.`,
	);
	console.error(
		'Add data-lp-key attributes and define text in src/lib/domain/labels.ts LP_* constants.',
	);
	if (htmlViolationFiles.length > 0) {
		console.error('Violation files:');
		for (const { file, count } of htmlViolationFiles) {
			console.error(`  ${file}: ${count} violation(s)`);
		}
	}
	failed = true;
}

if (failed) {
	process.exit(1);
}

if (svelteCount < baselineCount) {
	console.log(
		`\n[Svelte] Great! Count reduced by ${baselineCount - svelteCount}. Consider updating the baseline.`,
	);
}
if (baselineHtmlCount !== null && htmlCount < baselineHtmlCount) {
	console.log(
		`\n[HTML] Great! Count reduced by ${baselineHtmlCount - htmlCount}. Consider updating the baseline.`,
	);
}

console.log('OK: Hardcoded JP text counts are within baseline.');
