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
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const baselineFile = join(__dirname, 'lp-ssot-baseline.json');

// 法的文書はコンテンツの性質上 SSOT 化が不要のため除外する (#1465 Phase A)
const EXCLUDED_LEGAL_FILES = new Set([
	'site/privacy.html',
	'site/terms.html',
	'site/tokushoho.html',
	'site/sla.html',
]);

const baseline = JSON.parse(readFileSync(baselineFile, 'utf-8'));
const { count: baselineCount } = baseline;

const JP_REGEX = /[぀-ヿ一-龯㐀-䶿＀-￯]/;

function hasSsotAttribute(line) {
	return /data-lp-key=/.test(line) || /data-label=/.test(line) || /data-age-tier=/.test(line);
}

function hasVisibleJpText(line) {
	// Split on angle brackets to isolate text nodes (even indices) from tag content (odd indices)
	const segments = line.split(/[<>]/);
	return segments.filter((_, i) => i % 2 === 0).some((t) => JP_REGEX.test(t));
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
const allHtmlFiles = collectHtmlFiles(siteDir);

// 法的文書を除外
const htmlFiles = allHtmlFiles.filter((file) => {
	const rel = relative(root, file).replace(/\\/g, '/');
	return !EXCLUDED_LEGAL_FILES.has(rel);
});

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

// ============================================================
// LEGAL_LABELS coverage チェック (#1638 / #1590)
// ----------------------------------------------------------
// labels.ts の LEGAL_LABELS で定義された法律用語が
// site/privacy.html / site/terms.html に出現することを検証する。
// 文言ドリフト（規約 / プラポリで違う表現が混在）を防ぐため。
// ============================================================

const labelsFile = join(root, 'src/lib/domain/labels.ts');
const labelsSrc = readFileSync(labelsFile, 'utf-8');

// 簡易パーサ: `export const LEGAL_LABELS = { ... } as const;` の中の
// `key: 'value',` を抽出する（ネスト・関数値は対象外。LEGAL_LABELS は
// プレーンな文字列 key:value のみで構成する規約）
function extractLegalLabels(src) {
	const startMarker = 'export const LEGAL_LABELS = {';
	const startIdx = src.indexOf(startMarker);
	if (startIdx === -1) return null;
	const bodyStart = startIdx + startMarker.length;
	const endMarker = '} as const;';
	const endIdx = src.indexOf(endMarker, bodyStart);
	if (endIdx === -1) return null;
	const body = src.slice(bodyStart, endIdx);
	const result = {};
	for (const rawLine of body.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
		const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']*)'/);
		if (m) {
			result[m[1]] = m[2];
		}
	}
	return result;
}

const legalLabels = extractLegalLabels(labelsSrc);
if (!legalLabels) {
	console.error(
		'\nERROR [LEGAL-LABELS]: Failed to parse LEGAL_LABELS from src/lib/domain/labels.ts',
	);
	process.exit(1);
}

const legalDocs = [
	{ path: 'site/privacy.html', src: readFileSync(join(root, 'site/privacy.html'), 'utf-8') },
	{ path: 'site/terms.html', src: readFileSync(join(root, 'site/terms.html'), 'utf-8') },
];

// 各 LEGAL_LABELS の値が、少なくともどちらかの文書に部分一致すること
const missing = [];
for (const [key, value] of Object.entries(legalLabels)) {
	const found = legalDocs.some((doc) => doc.src.includes(value));
	if (!found) {
		missing.push({ key, value });
	}
}

console.log(
	`\n[LEGAL-LABELS] Coverage check: ${Object.keys(legalLabels).length} keys, ${missing.length} missing in legal docs`,
);

if (missing.length > 0) {
	console.error(
		'\nERROR [LEGAL-LABELS]: The following keys are not present in any legal document:',
	);
	for (const { key, value } of missing) {
		console.error(`  ${key} = '${value}'`);
	}
	console.error(
		'\nUpdate site/privacy.html or site/terms.html to include the value, or remove the key from LEGAL_LABELS in src/lib/domain/labels.ts.',
	);
	process.exit(1);
}

console.log('OK: All LEGAL_LABELS keys present in privacy.html or terms.html.');
