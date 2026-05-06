#!/usr/bin/env node
/**
 * scripts/check-lp-inline-style.mjs (#1851 Phase 2)
 *
 * site/*.html の <style>...</style> 内に存在する直書き padding / margin
 * (= var(--*) 経由でない数値 px / em / rem) を検出する。
 *
 * 目的:
 *   #1839 / #1850 (Phase 1) で `--lp-*` Semantic トークンを整備した。
 *   Phase 2 (本スクリプト) は「次回 LP 改修で新たに直書き padding/margin を
 *   増やすこと」を構造的に防ぐ。具体的には以下の 2 段階で運用する。
 *
 *   1. 既存の構造的 padding/margin (.section / .hero / .tour-card / .soft-card /
 *      .versus-card / .trust-badge / .faq-item / .floating-cta / .pp-band /
 *      .age-panel / .core-loop-card / .plan-card / .trial-box / .pricing-hero /
 *      .plans-section / .family-patterns / .faq-section / .cta-bottom 等) は
 *      Semantic トークン (--lp-*) 経由で参照されている (#1851 で全置換済)。
 *
 *   2. 本スクリプトは baseline 方式で残存ローカル装飾値 (gap / 微小余白 /
 *      絵文字 padding 等) を pin し、新規違反 1 件で exit 1 する。
 *      baseline 増加は意図的な PR として精査される。
 *
 * 検出対象:
 *   - <style>...</style> ブロック内の `padding[-*]?:\s*\d+(px|em|rem)`
 *   - <style>...</style> ブロック内の `margin[-*]?:\s*\d+(px|em|rem)`
 *
 * 検出対象外 (= 直書きを許容):
 *   - var(--*) 経由の参照 (例: `padding: var(--lp-section-padding-y)`)
 *   - 0 / auto 等の特殊値 (`padding:0` / `margin:0 auto`)
 *   - インライン style="" (#1851 Phase 2 では対象外、Phase 3 で検討)
 *   - calc() 経由の値
 *
 * Exit code: baseline 超過違反 1 件以上で 1, 問題なければ 0
 *
 * 使い方:
 *   node scripts/check-lp-inline-style.mjs                  # 全 HTML を検査
 *   node scripts/check-lp-inline-style.mjs --json           # JSON 出力 (artefact 用)
 *   node scripts/check-lp-inline-style.mjs --update-baseline # baseline 更新 (PR で意図的増減時のみ)
 *
 * 関連:
 *   - #1839 / PR #1850 (Phase 1: Base + Semantic トークン整備、主要 6 セレクタ置換)
 *   - #1851 (本 Issue: Phase 2 = stylelint hard-fail + 残直書き全置換)
 *   - ADR-0042 (LP CSS Spacing/Layout 3 層トークン)
 *   - ADR-0010 (Pre-PMF scope) — 既存 stylelint plugin より独自スクリプトを選定した根拠
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.filter((a) => a.startsWith('--'))
		.map((a) => {
			const [k, v] = a.replace(/^--/, '').split('=');
			return [k, v ?? 'true'];
		}),
);

const SITE_DIR = resolve(args['site-dir'] || join(REPO_ROOT, 'site'));
const BASELINE_PATH = resolve(REPO_ROOT, 'scripts/lp-inline-style-baseline.json');
const JSON_OUTPUT = args.json === 'true';
const UPDATE_BASELINE = args['update-baseline'] === 'true';

const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const DECL_RE = /(padding|margin)(?:-(?:block|inline|top|right|bottom|left))?\s*:\s*([^;}\n]+)/gi;
const NUMERIC_UNIT_RE = /^-?\d+(\.\d+)?(px|em|rem|%)$/;
const VAR_TOKEN_RE = /^var\(--[\w-]+\)$/;
const VAR_LEADING_RE = /^var\(--/;
const VAR_ONLY_VALUE_RE = /^[\s]*var\(--[\w-]+\)([\s]+(var\(--[\w-]+\)|[0]+|auto))*[\s]*$/;
const ZERO_AUTO_ONLY_RE = /^(\s*(0|auto)\s*)+$/;
const CALC_LEADING_RE = /^calc\(/;
const SPECIAL_VALUES = new Set(['0', 'auto', 'inherit', 'unset', 'initial']);

/**
 * site/ 直下の .html を列挙 (subdir は対象外、Phase 3 で help/ / legal 等に拡張可)
 */
function listSiteHtmlFiles() {
	const out = [];
	for (const entry of readdirSync(SITE_DIR)) {
		const full = join(SITE_DIR, entry);
		const st = statSync(full);
		if (st.isFile() && entry.endsWith('.html')) {
			out.push(full);
		}
	}
	return out.sort();
}

/**
 * <style>...</style> ブロックを抽出 (複数ある場合はリスト化)
 */
function extractStyleBlocks(html) {
	const blocks = [];
	for (const m of html.matchAll(STYLE_BLOCK_RE)) {
		blocks.push({
			content: m[1],
			startOffset: m.index + m[0].indexOf('>') + 1,
		});
	}
	return blocks;
}

/**
 * 文字 offset → 行番号変換
 */
function offsetToLine(html, offset) {
	let line = 1;
	for (let i = 0; i < offset && i < html.length; i++) {
		if (html[i] === '\n') line++;
	}
	return line;
}

/**
 * 値が許容パターン (0 / auto / var() のみ / calc() / 0+auto 組合せ) かを判定
 */
function isAllowedValue(value) {
	if (SPECIAL_VALUES.has(value)) return true;
	if (CALC_LEADING_RE.test(value)) return true;
	if (ZERO_AUTO_ONLY_RE.test(value)) return true;
	if (VAR_LEADING_RE.test(value) && VAR_ONLY_VALUE_RE.test(value)) return true;
	const tokens = value.split(/\s+/);
	const hasNumericUnit = tokens.some((t) => NUMERIC_UNIT_RE.test(t));
	if (!hasNumericUnit) return true;
	const allTokensAllowed = tokens.every((t) => VAR_TOKEN_RE.test(t) || t === '0' || t === 'auto');
	return allTokensAllowed;
}

/**
 * <style> ブロック 1 個から違反を抽出
 */
function findViolationsInBlock(block, html, sourceFile) {
	const violations = [];
	const lines = block.content.split('\n');
	const relPath = relative(REPO_ROOT, sourceFile).replace(/\\/g, '/');
	let lineOffset = 0;
	for (const line of lines) {
		for (const m of line.matchAll(DECL_RE)) {
			const [full, prop, valueRaw] = m;
			const value = valueRaw.trim();
			if (isAllowedValue(value)) continue;
			const lineInBlock = block.content.indexOf(line);
			const absoluteOffset = block.startOffset + (lineInBlock >= 0 ? lineInBlock : 0);
			const lineNumber = offsetToLine(html, absoluteOffset) + lineOffset;
			violations.push({
				file: relPath,
				line: lineNumber,
				property: prop,
				declaration: full.trim(),
				value,
			});
		}
		lineOffset++;
	}
	return violations;
}

/**
 * <style> ブロック内の直書き padding/margin を検出
 *
 * 許容パターン:
 *   - padding/margin: 0 (単独 0)
 *   - padding/margin: 0 auto / auto 0 (centering)
 *   - padding/margin: var(--*) (Semantic トークン経由)
 *   - padding/margin: calc(...) (動的計算)
 *
 * 違反パターン:
 *   - padding/margin: 数字 + (px|em|rem)
 *
 * shorthand (padding: 16px 8px / margin: 0 auto 4px) は最低 1 個の数値単位値が含まれれば違反扱い。
 */
function findInlineStyleViolations(html, sourceFile) {
	const violations = [];
	const blocks = extractStyleBlocks(html);
	for (const block of blocks) {
		violations.push(...findViolationsInBlock(block, html, sourceFile));
	}
	return violations;
}

function loadBaseline() {
	if (!existsSync(BASELINE_PATH)) {
		return { totals: {}, generatedAt: null };
	}
	try {
		return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
	} catch {
		return { totals: {}, generatedAt: null };
	}
}

function saveBaseline(totals) {
	const data = {
		_comment:
			'#1851 Phase 2 baseline: 構造的 padding/margin は --lp-* Semantic トークン経由 (#1851 / PR #1850 / ADR-0042)。本ファイルは残ローカル装飾値 (gap / 微小余白 / 絵文字 padding 等) のファイル別件数を pin する。新規違反 1 件で CI fail。意図的増減時のみ --update-baseline で更新する。',
		totals,
		generatedAt: new Date().toISOString(),
	};
	const json = JSON.stringify(data, null, '\t');
	writeFileSync(BASELINE_PATH, `${json}\n`, 'utf-8');
}

/**
 * ファイル一覧を走査し、各ファイルの violation 数 + 全 violation 詳細を返す
 */
function collectViolations(files) {
	const allViolations = [];
	const fileTotals = {};
	for (const file of files) {
		const html = readFileSync(file, 'utf-8');
		const v = findInlineStyleViolations(html, file);
		const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
		fileTotals[rel] = v.length;
		allViolations.push(...v);
	}
	return { allViolations, fileTotals };
}

/**
 * baseline と現状 totals を比較して exceedances を計算
 */
function calculateExceedances(fileTotals, baselineTotals) {
	const exceedances = [];
	for (const [file, count] of Object.entries(fileTotals)) {
		const allowed = baselineTotals[file] ?? 0;
		if (count > allowed) {
			exceedances.push({ file, baseline: allowed, current: count, delta: count - allowed });
		}
	}
	return exceedances;
}

function printHumanReport(fileTotals, baselineTotals, exceedances) {
	console.log('[check-lp-inline-style] file totals:');
	for (const [file, count] of Object.entries(fileTotals).sort()) {
		const allowed = baselineTotals[file] ?? 0;
		let marker = ' [BELOW]';
		if (count > allowed) marker = ' [EXCEEDS]';
		else if (count === allowed) marker = ' [OK]';
		console.log(`  ${file}: ${count} (baseline: ${allowed})${marker}`);
	}
	if (exceedances.length > 0) {
		console.log('\n[FAIL] baseline exceeded:');
		for (const e of exceedances) {
			console.log(`  ${e.file}: ${e.current} > ${e.baseline} (delta +${e.delta})`);
		}
		console.log(
			'\nFix:\n' +
				'  1. 新規追加した padding/margin が構造的なら --lp-* Semantic トークン (site/shared.css) 経由で参照する\n' +
				'  2. ローカル装飾値で意図的に増加させる場合は --update-baseline で baseline 更新 (PR レビューで合意必須)\n' +
				'  3. ADR-0042 / docs/DESIGN.md §4 LP Spacing/Layout 章を参照',
		);
	} else {
		console.log('\n[OK] all files within baseline');
	}
}

function main() {
	const files = listSiteHtmlFiles();
	const { allViolations, fileTotals } = collectViolations(files);

	if (UPDATE_BASELINE) {
		saveBaseline(fileTotals);
		if (!JSON_OUTPUT) {
			console.log(`[update-baseline] saved ${BASELINE_PATH}`);
			console.log('[update-baseline] totals:', fileTotals);
		}
		return 0;
	}

	const baseline = loadBaseline();
	const baselineTotals = baseline.totals || {};
	const exceedances = calculateExceedances(fileTotals, baselineTotals);

	if (JSON_OUTPUT) {
		console.log(
			JSON.stringify(
				{
					totals: fileTotals,
					baseline: baselineTotals,
					exceedances,
					violations: allViolations,
				},
				null,
				2,
			),
		);
	} else {
		printHumanReport(fileTotals, baselineTotals, exceedances);
	}

	return exceedances.length > 0 ? 1 : 0;
}

const code = main();
process.exit(code);
