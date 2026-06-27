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
 *
 * #3295 (EPIC #3260 F3 follow-up): `_guide.ts` への SSOT バイパス (生の日本語表示文字列の
 * 直書き) を `lintGuideSourceFiles` で機械検出する (ADR-0061 shift-left)。F3 で orphan 化した
 * `parseGuideSteps` (旧 `_guide.ts` ソースパーサ) は参照ゼロのため除去した。
 *
 * 検出する違反（機械検証可能な範囲）:
 *   (1) 謎用語 / 非 SSOT 用語の露出  — MYSTERY_TERMS を再利用（新用語を読み手に示さない）
 *   (2) 内部事情の露出              — route パス / *.svelte / data-tutorial= / 内部識別子
 *   (3) 簡潔さ違反                  — title/what/how/goal の文字数上限超過
 *   (4) step 数超過                — 1 ガイド ≤ 5 step（narrative 3 部構成、#2927 / ADR-0012）
 *   (5) SSOT バイパス               — `_guide.ts` の step に生の日本語表示文字列を直書き (#3295)
 *
 * 機械化が難しいポリシー（キーワード強調 / 上→下順 / 吹き出し非重複）は spec + review +
 * 既存の page-guide-layout-invariant.spec.ts で担保する。
 *
 * 使用法: npx tsx scripts/check-guide-copy.ts [--fail-on-violation]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_GUIDE_LABELS } from '../src/lib/domain/labels.js';
import { MYSTERY_TERMS } from './check-terminology-coherence.ts';

const FAIL_ON_VIOLATION = process.argv.includes('--fail-on-violation');

// scripts/ の 1 つ上 = リポジトリルート。`_guide.ts` walk の基点。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

// 表示文言フィールド (これらに生の日本語リテラルが直書きされたら SSOT バイパス、#3295)。
// `id` / `selector` / `position` / `requiredTier` / `icon` は表示文言ではないため対象外。
const GUIDE_DISPLAY_FIELDS = ['title', 'what', 'how', 'goal', 'tips'] as const;

// 日本語表示文字 (ひらがな / カタカナ / 漢字)。絵文字 (icon) はこの範囲に含まれないため誤検出しない。
const JP_DISPLAY_CHAR = /[぀-ゟ゠-ヿ㐀-䶿一-鿿]/;

export interface SourceCopyViolation {
	file: string;
	field: string;
	line: number;
	detail: string;
}

/**
 * `_guide.ts` の step / page-level 表示フィールドに「生の日本語表示文字列」が直書きされて
 * いないか (= `PAGE_GUIDE_LABELS` 経由 SSOT のバイパス) を検出する (#3295、ADR-0061 shift-left)。
 *
 * 各 `_guide.ts` の表示文言は `title: L.title` / `...L.steps['id']` の labels 参照のみで構成され、
 * `what:` / `how:` / `goal:` / `tips:` / `title:` に文字列・テンプレートリテラル直書きで日本語が
 * 現れたら違反とする (将来の SSOT バイパス予防)。`icon` 絵文字 / `selector` 等は対象外。
 *
 * source 文字列を行単位の heuristic で検査する純粋関数 (test 可能)。`L.steps['id']` の spread は
 * フィールドキー直書きではないため対象にならない。
 */
export function lintGuideSourceFile(source: string, fileRel: string): SourceCopyViolation[] {
	const violations: SourceCopyViolation[] = [];
	const lines = source.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		for (const field of GUIDE_DISPLAY_FIELDS) {
			// `field:` の直後に文字列 / テンプレートリテラル開始 (' / " / `) が来る行のみ対象。
			// `tips:` は配列なので `[` を挟むケース (`tips: ['…']`) も許容する。
			// `field: L.title` / `field: L.steps[...]` のような labels 参照は文字列開始でないため除外。
			const m = line.match(new RegExp(`^\\s*${field}:\\s*\\[?\\s*(['"\`])`));
			if (!m) continue;
			// その行 (複数行 backtick の場合は先頭行) に日本語表示文字が含まれていれば直書きとみなす。
			if (JP_DISPLAY_CHAR.test(line)) {
				violations.push({
					file: fileRel,
					field,
					line: i + 1,
					detail: `生の日本語表示文字列の直書き: ${line.trim().slice(0, 60)}`,
				});
			}
		}
	}
	return violations;
}

/**
 * 全 `src/routes/**\/_guide.ts` を読み、`lintGuideSourceFile` を適用する (#3295)。
 */
export function lintGuideSourceFiles(): SourceCopyViolation[] {
	const routesRoot = path.resolve(REPO_ROOT, 'src/routes');
	const files = findGuideSourceFiles(routesRoot);
	const all: SourceCopyViolation[] = [];
	for (const file of files) {
		const source = fs.readFileSync(file, 'utf8');
		const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
		all.push(...lintGuideSourceFile(source, rel));
	}
	return all;
}

/** `dir` 配下を再帰的に走査し `_guide.ts` の絶対パスを返す。 */
function findGuideSourceFiles(dir: string): string[] {
	const out: string[] = [];
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules') continue;
			out.push(...findGuideSourceFiles(full));
		} else if (entry.isFile() && entry.name === '_guide.ts') {
			out.push(full);
		}
	}
	return out;
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
	// #3295: `_guide.ts` への SSOT バイパス (生の日本語表示文字列直書き) も検査する。
	const sourceViolations = lintGuideSourceFiles();

	if (violations.length === 0 && sourceViolations.length === 0) {
		console.log('[check-guide-copy] ✓ PASS — ガイド文言ルール違反なし');
		return 0;
	}

	if (violations.length > 0) {
		console.log(`\n[check-guide-copy] PAGE_GUIDE_LABELS ${violations.length} 件の違反:`);
		for (const v of violations) {
			console.log(`  ${v.file} step${v.step} ${v.field} [${v.kind}]: ${v.detail}`);
		}
	}
	if (sourceViolations.length > 0) {
		console.log(
			`\n[check-guide-copy] _guide.ts SSOT バイパス ${sourceViolations.length} 件の違反 (#3295):`,
		);
		for (const v of sourceViolations) {
			console.log(`  ${v.file}:${v.line} ${v.field}: ${v.detail}`);
		}
		console.log(
			'\n  → 表示文言は labels.ts の PAGE_GUIDE_LABELS に追加し、`title: L.title` / `...L.steps[...]` で参照すること (ADR-0045 / #3295)。',
		);
	}
	console.log(
		'\n  ルール SSOT: docs/design/guide-copy-rules.md（新用語不可 / 簡潔 / 同義禁止 / 内部事情非開示 / ≤5 step / SSOT バイパス禁止）',
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
