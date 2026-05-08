/**
 * tests/unit/lp/pricing-html-no-hardcoded-1942.test.ts (#1942, Phase 3 D2)
 *
 * site/pricing.html の DOM AST 上で、`data-lp-key` 属性を持つ要素の
 * 配下 (= LP_LABELS から注入される fallback テキスト) **以外** の
 * テキストノードに hardcoded 用語が出現しないことを保証する回帰防止テスト。
 *
 * 設計背景:
 *   Phase 3 D5 (#1945 sync-lp-fallback.mjs) で fallback テキストは labels.ts と
 *   同期維持される。Phase 3 D7 (#1947) で LP_PRICING_LABELS / LP_PRICING_PHASEB_LABELS
 *   / LP_PRICING_EXTRA_LABELS の atom (price / plan / trial / free) は terms.ts
 *   参照に統一済。本テストは pricing.html 側で「data-lp-key を持たない要素に
 *   hardcoded 用語が混入する」という再発を構造的に防止する。
 *
 * 検査範囲:
 *   - 用語: 無料プラン / 7日間 / 7 日間 / スタンダードプラン / ファミリープラン /
 *     クレジットカード登録不要 / 基本無料 / いつでも解約 / クレカ登録不要
 *   - 検査対象: `<body>` 配下の text node。`<meta>` / `<title>` / `<script>` /
 *     `<style>` / HTML コメントは除外（SEO meta は ADR-0009 例外）
 *   - 許容: text node の祖先要素のいずれかに `data-lp-key` 属性がある場合
 *     (= shared-labels.js 経由で labels.ts 値で上書きされる fallback)
 *
 * AC マッピング (Issue #1942):
 *   - AC1: site/pricing.html 内の data-lp-key 経由でない hardcoded 用語を 0 件に
 *   - AC2: grep 相当で fallback 内側除く直書き 0 件 (本テストが parse5 AST で構造的に検証)
 *
 * 参考:
 *   - sibling Issue: #1941 (D1 site/index.html) / #1943 (D3 site/faq.html)
 *   - blocked_by: #1916 (terms.ts) / #1917 (template literal parser) / #1925 (PLAN_GATE_LABELS)
 *   - upstream merge: #1947 (Phase 3 D7) / #1945 (Phase 3 D5)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PRICING_HTML = path.join(REPO_ROOT, 'site/pricing.html');

/**
 * Issue #1942 で AC1 / AC2 が想定する hardcoded 用語の網羅リスト。
 * sibling Issue #1941 (D1) の AC2 grep 表現と整合させる。
 */
const HARDCODED_TERMS = [
	'無料プラン',
	'7日間',
	'7 日間',
	'スタンダードプラン',
	'ファミリープラン',
	'クレジットカード登録不要',
	'クレカ登録不要',
	'基本無料',
	'いつでも解約',
] as const;

const EXCLUDED_PARENT_TAGS: ReadonlySet<string> = new Set(['meta', 'title', 'script', 'style']);

interface AstNode {
	nodeName: string;
	value?: string;
	attrs?: Array<{ name: string; value: string }>;
	parentNode?: AstNode | null;
	childNodes?: AstNode[];
	content?: AstNode;
	sourceCodeLocation?: { startLine?: number };
}

interface Violation {
	line: number | undefined;
	parentTag: string;
	term: string;
	textSnippet: string;
}

/**
 * parse5 AST node の祖先に `data-lp-key` 属性があるか判定。
 * 子ノードから親へ遡り、いずれかの要素ノードが data-lp-key を持てば true。
 */
function hasLpKeyAncestor(node: AstNode | null | undefined): boolean {
	let cur = node?.parentNode ?? null;
	while (cur) {
		if (cur.attrs?.some((a) => a.name === 'data-lp-key')) return true;
		cur = cur.parentNode ?? null;
	}
	return false;
}

/**
 * 単一 text node を hardcoded 用語と照合し、違反 (data-lp-key 配下でなく
 * かつ除外 parent でない) があれば Violation 配列に push。
 */
function inspectTextNode(node: AstNode, violations: Violation[]): void {
	if (!node.value) return;
	const parentTag = node.parentNode?.nodeName ?? '?';
	if (EXCLUDED_PARENT_TAGS.has(parentTag)) return;
	if (hasLpKeyAncestor(node)) return;
	for (const term of HARDCODED_TERMS) {
		if (node.value.includes(term)) {
			violations.push({
				line: node.sourceCodeLocation?.startLine,
				parentTag,
				term,
				textSnippet: node.value.trim().substring(0, 80),
			});
		}
	}
}

/** AST 全体を再帰 walk して全 text node を inspectTextNode に流す。 */
function walkAst(node: AstNode | null | undefined, violations: Violation[]): void {
	if (!node) return;
	if (node.nodeName === '#text') inspectTextNode(node, violations);
	if (node.childNodes) for (const c of node.childNodes) walkAst(c, violations);
	if (node.content) walkAst(node.content, violations);
}

function collectViolations(root: AstNode): Violation[] {
	const violations: Violation[] = [];
	walkAst(root, violations);
	return violations;
}

/**
 * data-lp-key 配下の text node に少なくとも 1 件の hardcoded 用語が
 * 含まれているかを判定（sync-lp-fallback で labels.ts と同期維持される
 * fallback テキストの存在前提を担保する補助 assertion）。
 */
function hasFallbackTermInsideLpKey(node: AstNode | null | undefined): boolean {
	if (!node) return false;
	if (node.nodeName === '#text' && node.value) {
		const matched = HARDCODED_TERMS.some((t) => node.value?.includes(t));
		if (matched && hasLpKeyAncestor(node)) return true;
	}
	if (node.childNodes) {
		for (const c of node.childNodes) {
			if (hasFallbackTermInsideLpKey(c)) return true;
		}
	}
	if (node.content && hasFallbackTermInsideLpKey(node.content)) return true;
	return false;
}

describe('site/pricing.html — hardcoded 用語撤廃 (#1942 Phase 3 D2)', () => {
	it('AC1 / AC2: data-lp-key 経由でない hardcoded 用語が 0 件であること', () => {
		const html = readFileSync(PRICING_HTML, 'utf8');
		const doc = parse(html, { sourceCodeLocationInfo: true }) as unknown as AstNode;

		const violations = collectViolations(doc);

		// 違反内容を可視化（テスト失敗時の診断容易化のため詳細メッセージ生成）
		if (violations.length > 0) {
			const detail = violations
				.map((v) => `  L${v.line ?? '?'} <${v.parentTag}> "${v.term}" — "${v.textSnippet}"`)
				.join('\n');
			throw new Error(
				`[#1942 D2] data-lp-key を持たない位置に hardcoded 用語 ${violations.length} 件:\n${detail}\n\n` +
					'対応方針: 該当要素に data-lp-key 属性を追加し、labels.ts の対応 namespace に値を登録する。\n' +
					'fallback テキストは sync-lp-fallback.mjs 経由で labels.ts と同期される。',
			);
		}

		expect(violations).toHaveLength(0);
	});

	it('AC1 補強: data-lp-key 配下の fallback テキストには hardcoded 用語が出現する (改修時の前提条件)', () => {
		const html = readFileSync(PRICING_HTML, 'utf8');
		const doc = parse(html, { sourceCodeLocationInfo: true }) as unknown as AstNode;

		// data-lp-key 配下の fallback には hardcoded 用語が含まれている前提
		// (sync-lp-fallback.mjs が labels.ts 値で上書きするため、ここに用語があるのは正常)
		// 本 it は「fallback 配下に用語がある」ことを assert することで、
		// 上の it (AC1 / AC2) の意義 (= 'fallback 内側を除く' 表現の保証) を担保する。
		const found = hasFallbackTermInsideLpKey(doc);

		// 多数の hardcoded 用語が data-lp-key 配下 fallback として残っているはず
		// (Phase 3 D7 + D5 の運用結果として、labels.ts 経由で同期維持されている)
		expect(found).toBe(true);
	});
});
