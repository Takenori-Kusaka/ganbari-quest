#!/usr/bin/env node

/**
 * DESIGN.md の自動生成セクションを更新するスクリプト。
 *
 * 手書き部分（ブランド・禁忌・ポリシー）は触らず、
 * <!-- AUTOGEN:xxx --> ～ <!-- /AUTOGEN:xxx --> ブロックのみ書き換える。
 *
 * 対象:
 *   - AUTOGEN:colors    — app.css @theme ブロックからセマンティックトークン抽出
 *   - AUTOGEN:primitives — src/lib/ui/primitives/*.svelte 一覧
 *   - AUTOGEN:terms      — src/lib/domain/terms.ts の atom 定数 (#1923 / ADR-0045)
 *   - AUTOGEN:labels     — src/lib/domain/labels.ts の compound export 定数
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DESIGN_MD = resolve(ROOT, 'docs/DESIGN.md');

// --- Color Tokens ---
function extractSemanticTokens() {
	const css = readFileSync(resolve(ROOT, 'src/lib/ui/styles/app.css'), 'utf-8');

	const categories = {
		'Action（操作）': [],
		'Surface（背景）': [],
		'Border（枠線）': [],
		'Text（文字）': [],
		'Feedback（フィードバック）': [],
		その他: [],
	};

	// Match semantic tokens (lines with --color-action-*, --color-surface-*, etc.)
	const semanticPattern =
		/^\s*--(color-(?:action|surface|border|text|feedback)(?:-\S*)?):\s*(.+);/gm;
	for (const match of css.matchAll(semanticPattern)) {
		const name = `--${match[1]}`;
		const value = match[2].trim();
		if (name.startsWith('--color-action')) categories['Action（操作）'].push({ name, value });
		else if (name.startsWith('--color-surface'))
			categories['Surface（背景）'].push({ name, value });
		else if (name.startsWith('--color-border')) categories['Border（枠線）'].push({ name, value });
		else if (name.startsWith('--color-text')) categories['Text（文字）'].push({ name, value });
		else if (name.startsWith('--color-feedback'))
			categories['Feedback（フィードバック）'].push({ name, value });
		else categories.その他.push({ name, value });
	}

	let md = '';
	for (const [cat, tokens] of Object.entries(categories)) {
		if (tokens.length === 0) continue;
		md += `#### ${cat}\n\n`;
		md += '| トークン | 値 |\n|---------|----|\n';
		for (const t of tokens) {
			md += `| \`${t.name}\` | \`${t.value}\` |\n`;
		}
		md += '\n';
	}
	return md.trimEnd();
}

// --- Primitives ---
function listPrimitives() {
	const dir = resolve(ROOT, 'src/lib/ui/primitives');
	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.svelte') && !f.includes('.stories.'))
		.sort();

	let md = '| コンポーネント | インポートパス |\n|--------------|---------------|\n';
	for (const f of files) {
		const name = basename(f, '.svelte');
		md += `| ${name} | \`$lib/ui/primitives/${f}\` |\n`;
	}
	return md.trimEnd();
}

// --- Terms (atom) — #1923 / ADR-0045 ---
//
// terms.ts は atom 専用ファイル (≈86 行)。labels.ts (compound) と並列の SSOT として
// DESIGN.md §6 に独立セクションで掲載する。
//
// 抽出ルール:
//   - `export const <NAMESPACE>_TERMS = { ... } as const;` をブロック単位で抽出
//   - 各 namespace の key/value pair を 1 行 1 entry で table 化
//   - 数値 atom (例: TRIAL_TERMS.durationDays = 7) は数値のまま掲載
//   - atom 値そのものを表に出すことで「直書き禁止対象 (ADR-0045)」を可視化
function parseTermEntry(rawLine) {
	const line = rawLine.trim();
	if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
		return null;
	}
	const stringMatch = line.match(/^(\w+):\s*['"]([^'"]*)['"],?\s*(?:\/\/.*)?$/);
	if (stringMatch) {
		return { key: stringMatch[1], value: stringMatch[2], type: 'string' };
	}
	const numberMatch = line.match(/^(\w+):\s*(-?\d+(?:\.\d+)?),?\s*(?:\/\/.*)?$/);
	if (numberMatch) {
		return { key: numberMatch[1], value: numberMatch[2], type: 'number' };
	}
	return null;
}

function parseTermNamespace(body) {
	const entries = [];
	for (const rawLine of body.split('\n')) {
		const entry = parseTermEntry(rawLine);
		if (entry) entries.push(entry);
	}
	return entries;
}

function renderTermNamespace(ns) {
	if (ns.entries.length === 0) return '';
	let md = `#### ${ns.name}\n\n`;
	md += '| key | 値 |\n|-----|----|\n';
	for (const e of ns.entries) {
		const valueCell = e.type === 'string' ? `\`'${e.value}'\`` : `\`${e.value}\``;
		md += `| \`${e.key}\` | ${valueCell} |\n`;
	}
	md += '\n';
	return md;
}

function extractTerms() {
	const src = readFileSync(resolve(ROOT, 'src/lib/domain/terms.ts'), 'utf-8');
	const namespacePattern = /export const (\w+_TERMS) = \{([\s\S]*?)\} as const;/g;
	const namespaces = [];

	for (const match of src.matchAll(namespacePattern)) {
		namespaces.push({ name: match[1], entries: parseTermNamespace(match[2]) });
	}

	return namespaces.map(renderTermNamespace).join('').trimEnd();
}

// --- Labels ---
function extractLabels() {
	const src = readFileSync(resolve(ROOT, 'src/lib/domain/labels.ts'), 'utf-8');
	const exports = [];

	const constPattern = /export const (\w+)/g;
	for (const match of src.matchAll(constPattern)) {
		exports.push({ name: match[1], type: 'const' });
	}

	const funcPattern = /export function (\w+)/g;
	for (const match of src.matchAll(funcPattern)) {
		exports.push({ name: match[1], type: 'function' });
	}

	const typePattern = /export type (\w+)/g;
	for (const match of src.matchAll(typePattern)) {
		exports.push({ name: match[1], type: 'type' });
	}

	let md = '| エクスポート | 種類 | 用途 |\n|------------|------|------|\n';
	const descriptions = {
		NAV_CATEGORIES: 'ナビゲーションカテゴリ名',
		NAV_ITEM_LABELS: 'ナビゲーション項目ラベル',
		AGE_TIER_LABELS: '年齢区分ラベル（フル）',
		AGE_TIER_SHORT_LABELS: '年齢区分ラベル（短縮）',
		PLAN_LABELS: 'プラン名（フル）',
		PLAN_SHORT_LABELS: 'プラン名（短縮）',
		PAID_PLAN_LABEL: '有料プラン総称ラベル',
		THEME_LABELS: 'テーマ名',
		THEME_EMOJIS: 'テーマ絵文字',
		FEATURE_LABELS: '機能名ラベル',
		getAgeTierLabel: '年齢区分ラベル取得',
		getAgeTierShortLabel: '年齢区分短縮ラベル取得',
		getPlanLabel: 'プランラベル取得',
		getPlanShortLabel: 'プラン短縮ラベル取得',
		getThemeLabel: 'テーマラベル取得',
		getThemeOptions: 'テーマ選択肢一覧',
	};

	for (const e of exports) {
		const desc = descriptions[e.name] || '';
		md += `| \`${e.name}\` | ${e.type} | ${desc} |\n`;
	}
	return md.trimEnd();
}

// --- Main ---
function main() {
	let content = readFileSync(DESIGN_MD, 'utf-8');

	const sections = {
		colors: extractSemanticTokens(),
		primitives: listPrimitives(),
		terms: extractTerms(),
		labels: extractLabels(),
	};

	for (const [key, value] of Object.entries(sections)) {
		const start = `<!-- AUTOGEN:${key} -->`;
		const end = `<!-- /AUTOGEN:${key} -->`;
		const pattern = new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}`, 'g');
		content = content.replace(pattern, `${start}\n${value}\n${end}`);
	}

	writeFileSync(DESIGN_MD, content, 'utf-8');
	console.log('DESIGN.md updated successfully.');
	console.log(`  - colors: ${sections.colors.split('\n').length} lines`);
	console.log(`  - primitives: ${sections.primitives.split('\n').length} lines`);
	console.log(`  - terms: ${sections.terms.split('\n').length} lines`);
	console.log(`  - labels: ${sections.labels.split('\n').length} lines`);
}

function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main();
