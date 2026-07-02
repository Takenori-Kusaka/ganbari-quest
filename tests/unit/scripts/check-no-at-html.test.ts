/**
 * tests/unit/scripts/check-no-at-html.test.ts (#3354)
 *
 * `{@html}` 禁止 gate の違反抽出ロジックを検証する。サーバ値の {@html} 描画 (XSS) を
 * CI で機械的に block する不変条件の回帰防止。
 */

import { describe, expect, it } from 'vitest';

import { findAtHtmlViolations } from '../../../scripts/check-no-at-html.mjs';

describe('findAtHtmlViolations (#3354 {@html} 禁止 gate)', () => {
	it('{@html} を含む行を違反として検出する', () => {
		const content = ['<script>let x;</script>', '<p>{@html x}</p>', '<span>safe</span>'].join('\n');
		expect(findAtHtmlViolations(content)).toEqual([2]);
	});

	it('{@html} が無ければ違反ゼロ', () => {
		expect(findAtHtmlViolations('<p>{value}</p>\n<span>{label}</span>')).toEqual([]);
	});

	it('当該行の eslint-disable コメントで opt-out できる', () => {
		const content =
			'<p>{@html sanitized} <!-- eslint-disable-next-line svelte/no-at-html-tags --></p>';
		expect(findAtHtmlViolations(content)).toEqual([]);
	});

	it('直前行の eslint-disable-next-line で opt-out できる', () => {
		const content = [
			'<!-- eslint-disable-next-line svelte/no-at-html-tags -->',
			'<p>{@html sanitized}</p>',
		].join('\n');
		expect(findAtHtmlViolations(content)).toEqual([]);
	});

	it('allow-at-html: マーカーでも opt-out できる', () => {
		const content = ['<!-- allow-at-html: DOMPurify 済 -->', '<div>{@html clean}</div>'].join('\n');
		expect(findAtHtmlViolations(content)).toEqual([]);
	});

	it('複数違反を全て行番号で返す', () => {
		const content = ['{@html a}', 'x', '{@html b}'].join('\n');
		expect(findAtHtmlViolations(content)).toEqual([1, 3]);
	});
});
