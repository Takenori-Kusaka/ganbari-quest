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
 *
 * 注: AUTOGEN:labels は廃止 (ADR-0045 補遺)。labels.ts 全 export のミラーは
 *     参照価値が低く再生成のたびに肥大するため、DESIGN.md §6 はルール + 主要例のみを手書きで保持する。
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

	// トークン消費削減のため category ごとに 1 行コンパクト列挙 (旧: token ごとに table 行)。
	let md = '';
	for (const [cat, tokens] of Object.entries(categories)) {
		if (tokens.length === 0) continue;
		const cells = tokens.map((t) => `\`${t.name}\`=\`${t.value}\``);
		md += `- **${cat}**: ${cells.join(' / ')}\n`;
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
	// #1896 PO-4-10: HTML markup を含む atom (内部 `"` あり) も AUTOGEN 表に拾えるよう
	//   引用符マッチを「同じ引用符が値内に出現しないこと」のみで縛る (反対の引用符は許容)。
	//   先頭が ' のとき内部に ' を含まない / 先頭が " のとき内部に " を含まない。
	const singleQuotedMatch = line.match(/^(\w+):\s*'([^']*)',?\s*(?:\/\/.*)?$/);
	if (singleQuotedMatch) {
		return { key: singleQuotedMatch[1], value: singleQuotedMatch[2], type: 'string' };
	}
	const doubleQuotedMatch = line.match(/^(\w+):\s*"([^"]*)",?\s*(?:\/\/.*)?$/);
	if (doubleQuotedMatch) {
		return { key: doubleQuotedMatch[1], value: doubleQuotedMatch[2], type: 'string' };
	}
	const numberMatch = line.match(/^(\w+):\s*(-?\d+(?:\.\d+)?),?\s*(?:\/\/.*)?$/);
	if (numberMatch) {
		return { key: numberMatch[1], value: numberMatch[2], type: 'number' };
	}
	return null;
}

function parseTermNamespace(body) {
	const entries = [];
	// #1896 PO-4-10: Biome formatter が長い文字列値を自動的に次行に折り返すため、
	//   `key:` 単独行 + 次行 `'value',` の 2 行パターンも 1 entry として連結して扱う。
	const rawLines = body.split('\n');
	for (let i = 0; i < rawLines.length; i++) {
		const merged = rawLines[i];
		const next = rawLines[i + 1];
		// `<key>:` 行のみ (値なし) かつ次行が `'value',` 形式の場合は連結試行。
		const keyOnlyMatch = merged.trim().match(/^(\w+):\s*$/);
		if (keyOnlyMatch && next?.trim().match(/^['"][\s\S]*['"],?$/)) {
			const combined = `${keyOnlyMatch[1]}: ${next.trim()}`;
			const entry = parseTermEntry(combined);
			if (entry) {
				entries.push(entry);
				i += 1; // 値行を消費
				continue;
			}
		}
		const entry = parseTermEntry(merged);
		if (entry) entries.push(entry);
	}
	return entries;
}

function renderTermNamespace(ns) {
	if (ns.entries.length === 0) return '';
	// トークン消費削減のため namespace ごとに 1 行コンパクト列挙 (旧: entry ごとに table 行)。
	// atom 値そのものは ADR-0045「直書き禁止対象の可視化」のため引用符付きで保持する。
	const cells = ns.entries.map((e) =>
		e.type === 'string' ? `\`${e.key}\`=\`'${e.value}'\`` : `\`${e.key}\`=\`${e.value}\``,
	);
	return `- **${ns.name}**: ${cells.join(' / ')}\n`;
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
//
// labels.ts は 135+ namespace / ≈6700 行に肥大しており、その全 export 名を DESIGN.md に
// ミラーしても (1) 値を持たない名前の羅列で参照価値が低い、(2) 再生成のたびに肥大、
// (3) SSOT 整合性は CI (check-no-plan-literals / check-hardcoded-strings) が担保するため
// load-bearing でない、という理由で AUTOGEN 列挙を廃止した (ADR-0045 補遺)。
// DESIGN.md §6 は「使う前に labels.ts を grep する」ルール + 主要 namespace 例のみを手書きで保持する。

// --- Main ---
function main() {
	let content = readFileSync(DESIGN_MD, 'utf-8');

	const sections = {
		colors: extractSemanticTokens(),
		primitives: listPrimitives(),
		terms: extractTerms(),
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
}

function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main();
