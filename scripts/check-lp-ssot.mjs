#!/usr/bin/env node
/**
 * check-lp-ssot.mjs — Issue #1465 Phase A → #1703 Phase 1683-C
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
 *   - data-lp-key= 属性を持つ要素の配下行 (#1703: 複数行 SSOT element の中間行を免除)
 *
 * #1703 ADR-0009 supersede:
 *   - 旧 EXCLUDED_LEGAL_FILES（site/privacy.html / terms.html / sla.html / tokushoho.html）を削除
 *   - 法的文書も SSOT 化対象 (LP_LEGAL_PRIVACY_LABELS / TERMS / SLA / TOKUSHOHO 経由)
 *   - data-lp-key を持つ section / div / p / ol / table 等の中間行は免除する深さスタック追跡を追加
 *
 * #1703 LEGAL_LABELS coverage check rework:
 *   - 旧: LEGAL_LABELS の値が privacy.html / terms.html に部分一致するか（双方向同期）
 *   - 新: LP_LEGAL_*_LABELS の各キーが対応 HTML の data-lp-key で参照されているか（逆方向検証）
 *
 * Usage: node scripts/check-lp-ssot.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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
	// #1703: <title> タグは SEO 用静的 meta（ADR-0009 §例外「SEO 対象の静的 meta タグ」）
	// クローラは JS 実行しないため data-lp-key 注入できない。labels.ts と手動同期する。
	if (/^<title>.*<\/title>/.test(line)) {
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
 * #1703: data-lp-key= を含む開始タグの **タグ名** を返す。なければ null。
 *   - 自己完結タグ（同行内に対応する </tagName> または /> がある）の場合は null（スタックに積まない）
 *   - 例: <section data-lp-key="legalPrivacy.section1.title">第1条</section> → null
 *   - 例: <section data-lp-key="legalPrivacy.section1"> → 'section'
 */
function detectMultiLineSsotTag(line) {
	// data-lp-key= を含む属性を持つ開始タグを抽出
	const m = line.match(/<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*?\sdata-lp-key=|\sdata-lp-key=)[^>]*>/);
	if (!m) return null;
	const tagName = m[1].toLowerCase();
	// 同行内に対応する閉じタグがあるか（self-contained?）
	// 単純に </tagName> が同行内にあるかで判定
	const closeRegex = new RegExp(`</${tagName}\\s*>`);
	if (closeRegex.test(line)) return null;
	// 自己終了タグ（<br data-lp-key="..." /> 等）は対象外
	if (/data-lp-key=[^>]*\/>/.test(line)) return null;
	return tagName;
}

/**
 * #1703: 行内に開始タグ <tagName ...> がいくつあるか
 * （ネストカウンタ用、自己完結 / 自己終了は除外）
 */
function countOpenTags(line, tagName) {
	const re = new RegExp(`<${tagName}(\\s[^>]*)?>`, 'g');
	const matches = line.match(re) ?? [];
	// 自己終了 <tagName /> は除外（HTML だが念のため）
	return matches.filter((m) => !/\/>$/.test(m)).length;
}

/**
 * #1703: 行内に閉じタグ </tagName> がいくつあるか
 */
function countCloseTags(line, tagName) {
	const re = new RegExp(`</${tagName}\\s*>`, 'g');
	const matches = line.match(re) ?? [];
	return matches.length;
}

/**
 * #1703: ssotStack の depth を本行の open / close で更新し、終了したスコープを pop
 * 戻り値: 行が SSOT スコープ内（直前から継続）なら true（呼び出し側は違反判定を skip）
 */
function updateSsotStack(line, ssotStack) {
	if (ssotStack.length === 0) return false;
	for (const item of ssotStack) {
		const opens = countOpenTags(line, item.tagName);
		const closes = countCloseTags(line, item.tagName);
		item.depth += opens - closes;
	}
	while (ssotStack.length > 0 && ssotStack[ssotStack.length - 1].depth <= 0) {
		ssotStack.pop();
	}
	if (ssotStack.length > 0) {
		const newTag = detectMultiLineSsotTag(line);
		if (newTag) {
			ssotStack.push({ tagName: newTag, depth: 1 });
		}
		return true;
	}
	return false;
}

function checkHtmlFile(filePath) {
	const src = readFileSync(filePath, 'utf-8');
	const lines = src.split('\n');
	let state = { inStyle: false, inScript: false, inComment: false };
	let violations = 0;

	// #1703: data-lp-key= を持つ複数行 element をスタック追跡
	const ssotStack = [];

	for (const rawLine of lines) {
		const line = rawLine.trim();
		state = updateBlockState(line, state);
		if (state.skip) continue;

		// #1703: 直前から継続中の SSOT スコープ内ならスキップ
		if (updateSsotStack(line, ssotStack)) continue;

		// 行に data-lp-key= を含む multi-line SSOT 開始タグがあれば push
		const newTag = detectMultiLineSsotTag(line);
		if (newTag) {
			ssotStack.push({ tagName: newTag, depth: 1 });
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
			file: relative(root, file).replace(/\\/g, '/'),
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
// LEGAL coverage check rework (#1703 / ADR-0009 supersede / ADR-0025)
// ----------------------------------------------------------
// 旧: LEGAL_LABELS の値が privacy.html / terms.html に部分一致するか（双方向同期）
// 新: LP_LEGAL_PRIVACY_LABELS / TERMS / SLA / TOKUSHOHO の各キーが
//     対応 HTML 内で data-lp-key="<namespace>.<key>" として参照されているか（逆方向検証）
//
// LEGAL_LABELS（既存 12 keys、ドメインユースで参照される法律用語）は
// アプリ側の同意フォーム等で使うため、SSOT 値そのものは labels.ts に温存される。
// 本チェックでは LEGAL_LABELS の HTML 出現有無は問わない（HTML は SSOT 化されているため）。
// ============================================================

const labelsFile = join(root, 'src/lib/domain/labels.ts');
const labelsSrc = readFileSync(labelsFile, 'utf-8');

/**
 * 与えた export const NAME = { ... } as const; ブロックからキー一覧を抽出
 * 値が複数行リテラルでも問題ない（キーだけ拾う）
 */
function extractKeysOf(src, constName) {
	const startMarker = `export const ${constName}`;
	const startIdx = src.indexOf(startMarker);
	if (startIdx === -1) return null;
	const blockStart = src.indexOf('{', startIdx);
	if (blockStart === -1) return null;
	let depth = 0;
	let i = blockStart;
	while (i < src.length) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}') {
			depth--;
			if (depth === 0) break;
		}
		i++;
	}
	if (depth !== 0) return null;
	const body = src.slice(blockStart + 1, i);
	const keys = [];
	// シンプルな key 抽出: 行頭（または行先頭の ` `）から `<key>:` の形
	for (const rawLine of body.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
		// `key: 'value...` または `key:` 形式
		const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
		if (m) keys.push(m[1]);
	}
	return keys;
}

/**
 * LEGAL 系 namespace と対応 HTML ファイルのマッピング
 */
const LEGAL_NAMESPACES = [
	{
		constName: 'LP_LEGAL_PRIVACY_LABELS',
		htmlPath: 'site/privacy.html',
		dataLpKeyPrefix: 'legalPrivacy',
	},
	{
		constName: 'LP_LEGAL_TERMS_LABELS',
		htmlPath: 'site/terms.html',
		dataLpKeyPrefix: 'legalTerms',
	},
	{
		constName: 'LP_LEGAL_SLA_LABELS',
		htmlPath: 'site/sla.html',
		dataLpKeyPrefix: 'legalSla',
	},
	{
		constName: 'LP_LEGAL_TOKUSHOHO_LABELS',
		htmlPath: 'site/tokushoho.html',
		dataLpKeyPrefix: 'legalTokushoho',
	},
];

let legalErrors = 0;
let legalChecked = 0;

for (const ns of LEGAL_NAMESPACES) {
	const keys = extractKeysOf(labelsSrc, ns.constName);
	if (keys === null) {
		console.error(`\nERROR [LEGAL-SSOT]: ${ns.constName} not found in src/lib/domain/labels.ts`);
		legalErrors++;
		continue;
	}
	const htmlSrc = readFileSync(join(root, ns.htmlPath), 'utf-8');
	const missingKeys = [];
	for (const key of keys) {
		// 対応 HTML 内に data-lp-key="<prefix>.<key>" が含まれているか
		const needle1 = `data-lp-key="${ns.dataLpKeyPrefix}.${key}"`;
		const needle2 = `data-lp-key='${ns.dataLpKeyPrefix}.${key}'`;
		if (!htmlSrc.includes(needle1) && !htmlSrc.includes(needle2)) {
			missingKeys.push(key);
		}
	}
	legalChecked += keys.length;
	console.log(
		`[LEGAL-SSOT] ${ns.constName} → ${ns.htmlPath}: ${keys.length} keys, ${missingKeys.length} missing references`,
	);
	if (missingKeys.length > 0) {
		console.error(
			`\nERROR [LEGAL-SSOT]: The following keys in ${ns.constName} are not referenced via data-lp-key in ${ns.htmlPath}:`,
		);
		for (const key of missingKeys) {
			console.error(`  ${ns.dataLpKeyPrefix}.${key}`);
		}
		legalErrors++;
	}
}

if (legalErrors > 0) {
	console.error(
		`\n[LEGAL-SSOT] ${legalErrors} namespace(s) have missing references. Add data-lp-key="<prefix>.<key>" attributes to the corresponding HTML, or remove the unused keys from labels.ts.`,
	);
	process.exit(1);
}

console.log(
	`\nOK: All ${legalChecked} LEGAL namespace keys (LP_LEGAL_PRIVACY/TERMS/SLA/TOKUSHOHO) are referenced via data-lp-key in their HTML files.`,
);
