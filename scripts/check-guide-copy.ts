#!/usr/bin/env node
/**
 * scripts/check-guide-copy.ts (#3261 / EPIC #3260 F0)
 *
 * ページガイド文言が「ガイド文言 作成ルール SSOT」(docs/design/guide-copy-rules.md) に
 * 準拠しているかを機械検証する linter。check-terminology-coherence.ts (#2555) を母体に、
 * ガイド文言固有の規約を追加する。
 *
 * #3264 (EPIC #3260 F3): ガイド文言は `_guide.ts` のインライン直書きから labels.ts の
 * PAGE_GUIDE_LABELS (compound 層 SSOT、ADR-0045) に集約された。本 linter は検査ソースを
 * labels.ts の PAGE_GUIDE_LABELS に切替える（構造化済 object を直接 import して flatten）。
 * 閾値・検査ロジック (MYSTERY_TERMS / 内部識別子露出 / 文字数上限 / step 数) は不変。
 *   - `parseGuideSteps` (旧 `_guide.ts` ソースパーサ) は後方互換のため export 維持。
 *
 * 検出する違反（機械検証可能な範囲）:
 *   (1) 謎用語 / 非 SSOT 用語の露出  — MYSTERY_TERMS を再利用（新用語を読み手に示さない）
 *   (2) 内部事情の露出              — route パス / *.svelte / data-tutorial= / 内部識別子
 *   (3) 簡潔さ違反                  — title/what/how/goal の文字数上限超過
 *   (4) step 数超過                — 1 ガイド ≤ 5 step（narrative 3 部構成、#2927 / ADR-0012）
 *
 * 機械化が難しいポリシー（キーワード強調 / 上→下順 / 吹き出し非重複）は spec + review +
 * 既存の page-guide-layout-invariant.spec.ts で担保する。
 *
 * 使用法: npx tsx scripts/check-guide-copy.ts [--fail-on-violation]
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PAGE_GUIDE_LABELS } from '../src/lib/domain/labels.js';
import { MYSTERY_TERMS } from './check-terminology-coherence.ts';

const FAIL_ON_VIOLATION = process.argv.includes('--fail-on-violation');

// ガイド文言の文字数上限（research: tooltip microcopy ≤150 字 / 1-2 文。narrative ガイドは
// やや長いが冗長を防ぐ上限。${...} SSOT 参照は代表長 6 字に畳んで概算）。
// 既存 11 ガイドの実測 max（title 20 / what 107 / how 102 / goal 59）に余裕を持たせつつ、
// research（microcopy ≤150 字）に寄せた上限。新規ガイドの冗長化を防ぐ。
export const COPY_LIMITS = {
	title: 40,
	what: 150,
	how: 200,
	goal: 130,
} as const;

// 1 ガイドの step 数上限（#2927 narrative ≤5 step）。
export const MAX_STEPS = 5;

// 内部事情の露出パターン（ユーザー向け文言に出してはいけない）。
const INTERNAL_LEAK_PATTERNS: { re: RegExp; reason: string }[] = [
	{ re: /\/admin\/|\/marketplace\/|\/\(parent\)|\/\(child\)/, reason: 'route パス露出' },
	{ re: /\.svelte\b/, reason: 'コンポーネントファイル名露出' },
	{ re: /data-tutorial=/, reason: 'selector / data 属性露出' },
	{ re: /\b(free|standard|premium|family)Tier\b|requiredTier/, reason: '内部プラン識別子露出' },
];

export interface GuideStepText {
	title?: string;
	what?: string;
	how?: string;
	goal?: string;
	tips?: string[];
}

export interface CopyViolation {
	file: string;
	step: number;
	field: string;
	kind: 'mystery' | 'internal' | 'length' | 'steps';
	detail: string;
}

const TEXT_FIELDS = ['title', 'what', 'how', 'goal'] as const;

/**
 * `${...}` を代表長 6 字のプレースホルダに畳み、`\n` を 1 字として概算長を返す。
 */
function approxLength(value: string): number {
	return value.replace(/\$\{[^}]*\}/g, 'XXXXXX').replace(/\\n/g, ' ').length;
}

/**
 * `_guide.ts` のソースから step ごとの text フィールドを抽出する（軽量パーサ）。
 * '...' / "..." / `...`（複数行 backtick）に対応。selector は対象外（内部属性のため）。
 */
export function parseGuideSteps(source: string): GuideStepText[] {
	// steps: [ ... ] の範囲を粗く取得（最初の steps: [ から対応する閉じ ] まで）。
	const stepsStart = source.indexOf('steps:');
	const region = stepsStart >= 0 ? source.slice(stepsStart) : source;

	const steps: GuideStepText[] = [];
	let current: GuideStepText | null = null;

	const lines = region.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		// 新 step の境界: `id:` で始まるプロパティ（各 step は必ず id を持つ）。
		if (/^\s*id:\s*['"`]/.test(line)) {
			if (current) steps.push(current);
			current = {};
			continue;
		}
		if (!current) continue;

		for (const field of TEXT_FIELDS) {
			const m = line.match(new RegExp(`^\\s*${field}:\\s*(['"\`])`));
			if (!m) continue;
			const quote = m[1] as string;
			// 同一行で閉じるか（' / "）、複数行（\`）か
			const rest = line.slice(line.indexOf(quote) + 1);
			const closeIdx = rest.indexOf(quote);
			if (quote !== '`' && closeIdx >= 0) {
				current[field] = rest.slice(0, closeIdx);
			} else {
				// backtick 複数行: 閉じ backtick まで連結
				let acc = rest;
				let closed = rest.includes('`');
				if (closed) {
					current[field] = rest.slice(0, rest.indexOf('`'));
				} else {
					for (let j = i + 1; j < lines.length && !closed; j++) {
						const l = lines[j] ?? '';
						const ci = l.indexOf('`');
						if (ci >= 0) {
							acc += `\n${l.slice(0, ci)}`;
							closed = true;
							i = j;
						} else {
							acc += `\n${l}`;
						}
					}
					current[field] = acc;
				}
			}
		}
	}
	if (current) steps.push(current);
	return steps;
}

/** 抽出済み step 群を rule に照らして違反を返す（純粋関数、test 可能）。 */
export function lintGuideSteps(steps: GuideStepText[], fileRel: string): CopyViolation[] {
	const violations: CopyViolation[] = [];

	if (steps.length > MAX_STEPS) {
		violations.push({
			file: fileRel,
			step: 0,
			field: 'steps',
			kind: 'steps',
			detail: `step 数 ${steps.length} > ${MAX_STEPS}（narrative 3 部構成 ≤5 step）`,
		});
	}

	steps.forEach((step, idx) => {
		for (const field of TEXT_FIELDS) {
			const value = step[field];
			if (!value) continue;

			// (1) 謎用語 / 非 SSOT 用語
			for (const { pattern, reason } of MYSTERY_TERMS) {
				if (value.includes(pattern)) {
					violations.push({
						file: fileRel,
						step: idx + 1,
						field,
						kind: 'mystery',
						detail: `"${pattern}" → ${reason}`,
					});
				}
			}

			// (2) 内部事情の露出
			for (const { re, reason } of INTERNAL_LEAK_PATTERNS) {
				if (re.test(value)) {
					violations.push({
						file: fileRel,
						step: idx + 1,
						field,
						kind: 'internal',
						detail: `${reason}: ${value.slice(0, 60)}`,
					});
				}
			}

			// (3) 簡潔さ（文字数上限）
			const limit = COPY_LIMITS[field];
			const len = approxLength(value);
			if (len > limit) {
				violations.push({
					file: fileRel,
					step: idx + 1,
					field,
					kind: 'length',
					detail: `${len} 字 > ${limit} 字（簡潔・端的に）`,
				});
			}
		}
	});

	return violations;
}

/**
 * PAGE_GUIDE_LABELS の 1 ページ分 (steps object) を step 順を保って GuideStepText[] に flatten する。
 * #3264: ガイド文言 SSOT が labels.ts に移ったため、検査ソースは object literal を直接読む。
 */
function flattenGuideSteps(steps: Record<string, GuideStepText>): GuideStepText[] {
	return Object.values(steps).map((s) => ({
		title: s.title,
		what: s.what,
		how: s.how,
		goal: s.goal,
		tips: s.tips ? [...s.tips] : undefined,
	}));
}

export function lintAllGuides(): CopyViolation[] {
	const all: CopyViolation[] = [];
	for (const [pageKey, page] of Object.entries(PAGE_GUIDE_LABELS)) {
		const steps = flattenGuideSteps(page.steps as Record<string, GuideStepText>);
		// rel は「どのガイドか」を違反メッセージに示すための識別子。
		all.push(...lintGuideSteps(steps, `PAGE_GUIDE_LABELS.${pageKey}`));
	}
	return all;
}

function main(): number {
	console.log('[check-guide-copy] #3261 / EPIC #3260 F0 — ガイド文言ルール linter');
	const violations = lintAllGuides();

	if (violations.length === 0) {
		console.log('[check-guide-copy] ✓ PASS — ガイド文言ルール違反なし');
		return 0;
	}

	console.log(`\n[check-guide-copy] ${violations.length} 件の違反:`);
	for (const v of violations) {
		console.log(`  ${v.file} step${v.step} ${v.field} [${v.kind}]: ${v.detail}`);
	}
	console.log(
		'\n  ルール SSOT: docs/design/guide-copy-rules.md（新用語不可 / 簡潔 / 同義禁止 / 内部事情非開示 / ≤5 step）',
	);
	return FAIL_ON_VIOLATION ? 1 : 0;
}

const isMain = (() => {
	if (typeof process === 'undefined') return false;
	const argv1 = process.argv[1];
	if (!argv1) return false;
	try {
		return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(argv1);
	} catch {
		return false;
	}
})();

if (isMain) {
	process.exit(main());
}
