// tests/unit/site-terminology.test.ts
// #1164: LP で「持ち物チェックリスト」「ルーティンチェックリスト」「やることリスト」の
//        3 語が出現し、**同じ段落内で複数の語を混在させない** ことを保証。
//
// ADR-0037 (labels.ts SSOT) + #1168 (CL 種別分離) と同期。
// 乱雑な混在が再発した #162 系問題の再発防止。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const TERMS = ['持ち物チェックリスト', 'ルーティンチェックリスト', 'やることリスト'] as const;

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

		it('同じ段落内で 3 語のうち複数を混在させない', () => {
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
	});
});
