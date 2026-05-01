// tests/unit/site-terminology.test.ts
// #1164: LP で「持ち物チェックリスト」が出現し、**同じ段落内で複数の語を混在させない** ことを保証。
//
// ADR-0037 (labels.ts SSOT) + #1168 (CL 種別分離) と同期。
// 乱雑な混在が再発した #162 系問題の再発防止。
// Note: 「やることリスト」は #1287/#1573 のLP改訂（soft-features 4カード拡張）で
//       LP から削除されたため、存在チェックの対象から除外（2026-04-27）。
// Note 2: 「ルーティンチェックリスト」は #1708 R3-A / ADR-0027 で LP から削除され、
//       FORBIDDEN_TERMS にも追加された。出現すべきでない語として扱う（2026-04-30）。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

// 出現すべき語（LP の現行訴求と一致）
const TERMS = ['持ち物チェックリスト'] as const;
// 出現すべきでない語（廃止語彙）
const FORBIDDEN_TERMS = ['ルーティンチェックリスト'] as const;

function loadHtml(relPath: string): string {
	return readFileSync(resolve(relPath), 'utf8');
}

/**
 * <p>, <li>, <h1>..<h6>, <td>, <th> のテキストノードを抽出。
 * JSDOM ベースで正確に AST パース（正規表現による HTML ストリップは CodeQL
 * js/incomplete-multi-character-sanitization で警告されるため避ける）。
 * <br> は段落境界とみなさない（同一段落内に存在 = 混在とみなす）。
 */
function extractParagraphTexts(html: string): string[] {
	const dom = new JSDOM(html);
	const doc = dom.window.document;
	const paragraphs: string[] = [];
	const selectors = ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th'];
	for (const el of doc.querySelectorAll(selectors.join(','))) {
		const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (text.length > 0) paragraphs.push(text);
	}
	return paragraphs;
}

describe('#1164 LP terminology separation', () => {
	describe('site/index.html', () => {
		const html = loadHtml('site/index.html');

		for (const term of TERMS) {
			it(`「${term}」が少なくとも 1 回出現する`, () => {
				expect(html.includes(term), `"${term}" が site/index.html に見つからない`).toBe(true);
			});
		}

		// #1708 R3-A: 廃止語彙が LP に再混入していないか
		for (const term of FORBIDDEN_TERMS) {
			it(`廃止語「${term}」が出現しない（#1708 R3-A / ADR-0027）`, () => {
				expect(
					html.includes(term),
					`"${term}" は廃止語彙のため LP に出現してはならない (kind=routine 削除 + 活動 priority='must' 移管)`,
				).toBe(false);
			});
		}

		it('同じ段落内で対象語のうち複数を混在させない', () => {
			const paragraphs = extractParagraphTexts(html);
			const violations: string[] = [];
			for (const para of paragraphs) {
				const present = TERMS.filter((t) => para.includes(t));
				if (present.length > 1) {
					violations.push(`[${present.join(' + ')}] in "${para.slice(0, 80)}..."`);
				}
			}
			expect(violations, `混在違反:\n${violations.join('\n')}`).toEqual([]);
		});
	});

	describe('site/pamphlet.html と site/shared-labels.js の整合', () => {
		it('pamphlet.html で用語の混在違反がない', () => {
			const html = loadHtml('site/pamphlet.html');
			const paragraphs = extractParagraphTexts(html);
			const violations: string[] = [];
			for (const para of paragraphs) {
				const present = TERMS.filter((t) => para.includes(t));
				if (present.length > 1) {
					violations.push(`[${present.join(' + ')}] in "${para.slice(0, 80)}..."`);
				}
			}
			expect(violations, `混在違反:\n${violations.join('\n')}`).toEqual([]);
		});

		// #1708 R3-A: pamphlet.html にも廃止語彙が混入していないか
		for (const term of FORBIDDEN_TERMS) {
			it(`pamphlet.html に廃止語「${term}」が出現しない`, () => {
				const html = loadHtml('site/pamphlet.html');
				expect(
					html.includes(term),
					`"${term}" は廃止語彙のため pamphlet に出現してはならない`,
				).toBe(false);
			});
		}
	});
});
