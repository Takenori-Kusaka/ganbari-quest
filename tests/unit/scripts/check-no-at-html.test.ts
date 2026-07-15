/**
 * tests/unit/scripts/check-no-at-html.test.ts (#3354 / #3450)
 *
 * `{@html}` 禁止 gate の違反抽出ロジックを検証する。サーバ値の {@html} 描画 (XSS) を
 * CI で機械的に block する不変条件の回帰防止。
 * #3450 で追加された TS/JS innerHTML sink 検出 (item2) と opt-out 時の sanitizer
 * 実在検証 (item3) の正・負ケースも本ファイルで担保する。
 */

import { describe, expect, it } from 'vitest';

import {
	findAtHtmlViolations,
	findTsSinkViolations,
	findUnsanitizedAtHtmlOptOuts,
} from '../../../scripts/check-no-at-html.mjs';

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

describe('findUnsanitizedAtHtmlOptOuts (#3450 item3 opt-out sanitizer 実在検証)', () => {
	it('opt-out 済 {@html} でも同一ファイルに sanitizer 実呼び出しが無ければ違反', () => {
		const content = ['<!-- allow-at-html: 済のつもり -->', '<div>{@html raw}</div>'].join('\n');
		expect(findUnsanitizedAtHtmlOptOuts(content)).toEqual([2]);
	});

	it('同一ファイル内に DOMPurify.sanitize 呼び出しがあれば違反ゼロ', () => {
		const content = [
			'<script>',
			"import DOMPurify from 'dompurify';",
			'const clean = DOMPurify.sanitize(raw);',
			'</script>',
			'<!-- allow-at-html: DOMPurify 済 -->',
			'<div>{@html clean}</div>',
		].join('\n');
		expect(findUnsanitizedAtHtmlOptOuts(content)).toEqual([]);
	});

	it('sanitizeHtml() 呼び出しでも同等 sanitizer として許容する', () => {
		const content = [
			'<script>const clean = sanitizeHtml(raw);</script>',
			'<!-- eslint-disable-next-line svelte/no-at-html-tags -->',
			'<div>{@html clean}</div>',
		].join('\n');
		expect(findUnsanitizedAtHtmlOptOuts(content)).toEqual([]);
	});

	it('マーカー文言に DOMPurify と書くだけでは sanitizer 実呼び出しと見なさない', () => {
		const content = ['<!-- allow-at-html: DOMPurify で処理済と主張 -->', '{@html raw}'].join('\n');
		expect(findUnsanitizedAtHtmlOptOuts(content)).toEqual([2]);
	});

	it('opt-out していない {@html} は本関数の対象外 (findAtHtmlViolations が担う)', () => {
		expect(findUnsanitizedAtHtmlOptOuts('<div>{@html raw}</div>')).toEqual([]);
	});
});

describe('findTsSinkViolations (#3450 item2 TS/JS innerHTML sink 検出)', () => {
	it('innerHTML への代入を違反として検出する', () => {
		const content = ['const el = document.createElement("div");', 'el.innerHTML = userInput;'].join(
			'\n',
		);
		expect(findTsSinkViolations(content)).toEqual({ violations: [2], unsanitizedOptOuts: [] });
	});

	it('innerHTML への += 追記も検出する', () => {
		expect(findTsSinkViolations('el.innerHTML += chunk;').violations).toEqual([1]);
	});

	it('insertAdjacentHTML 呼び出しを検出する', () => {
		expect(findTsSinkViolations("el.insertAdjacentHTML('beforeend', html);").violations).toEqual([
			1,
		]);
	});

	it('outerHTML への代入を検出する', () => {
		expect(findTsSinkViolations('node.outerHTML = replacement;').violations).toEqual([1]);
	});

	it('比較演算 (=== / ==) は代入ではないため検出しない', () => {
		const content = ["if (el.innerHTML === '') { reset(); }", 'if (el.outerHTML == raw) {}'].join(
			'\n',
		);
		expect(findTsSinkViolations(content).violations).toEqual([]);
	});

	it('innerHTML の読み取りは検出しない', () => {
		expect(findTsSinkViolations('const snapshot = el.innerHTML;').violations).toEqual([]);
	});

	it('コメント行のサンプル記述は検出しない', () => {
		const content = [
			'// NG 例: el.innerHTML = raw; と書いてはならない',
			' * el.insertAdjacentHTML("beforeend", x) は禁止',
			'/* el.outerHTML = y も禁止 */',
		].join('\n');
		expect(findTsSinkViolations(content).violations).toEqual([]);
	});

	it('allow-innerhtml: マーカー + sanitizer 実呼び出しで opt-out できる', () => {
		const content = [
			"import DOMPurify from 'dompurify';",
			'const clean = DOMPurify.sanitize(raw);',
			'// allow-innerhtml: DOMPurify 済 (ADR-0025)',
			'el.innerHTML = clean;',
		].join('\n');
		expect(findTsSinkViolations(content)).toEqual({ violations: [], unsanitizedOptOuts: [] });
	});

	it('allow-innerhtml: マーカーがあっても sanitizer 実呼び出しが無ければ違反 (#3450 item3)', () => {
		const content = ['// allow-innerhtml: 済のつもり', 'el.innerHTML = raw;'].join('\n');
		expect(findTsSinkViolations(content)).toEqual({ violations: [], unsanitizedOptOuts: [2] });
	});

	it('当該行末尾の allow-innerhtml: マーカーでも opt-out できる', () => {
		const content = [
			'const clean = DOMPurify.sanitize(raw);',
			'el.innerHTML = clean; // allow-innerhtml: DOMPurify 済',
		].join('\n');
		expect(findTsSinkViolations(content)).toEqual({ violations: [], unsanitizedOptOuts: [] });
	});

	it('複数 sink を全て行番号で返す', () => {
		const content = ['a.innerHTML = x;', 'safe();', "b.insertAdjacentHTML('afterbegin', y);"].join(
			'\n',
		);
		expect(findTsSinkViolations(content).violations).toEqual([1, 3]);
	});
});

describe('findTsSinkViolations (#3741 bracket 記法 / document.write / logical assign residual)', () => {
	// #3671 QM Tier2 で実証された evasion (dot 記法限定 gap) の回帰 fixture (ADR-0006:
	// 危険コードで実 fail を assert する)。ここが MISS に戻ったら gate の網羅宣言が偽になる。
	it("bracket 記法 el['innerHTML'] = x (single quote) を違反として検出する", () => {
		expect(findTsSinkViolations("el['innerHTML'] = userInput;").violations).toEqual([1]);
	});

	it('bracket 記法 el["innerHTML"] += x (double quote) を検出する', () => {
		expect(findTsSinkViolations('el["innerHTML"] += chunk;').violations).toEqual([1]);
	});

	it("bracket 記法 el['outerHTML'] = x を検出する", () => {
		expect(findTsSinkViolations("node['outerHTML'] = replacement;").violations).toEqual([1]);
	});

	it("bracket 記法 el[ 'innerHTML' ] = x (空白入り) も検出する", () => {
		expect(findTsSinkViolations("el[ 'innerHTML' ] = userInput;").violations).toEqual([1]);
	});

	it("bracket 記法 insertAdjacentHTML 呼び出し el['insertAdjacentHTML'](...) を検出する", () => {
		expect(findTsSinkViolations("el['insertAdjacentHTML']('beforeend', html);").violations).toEqual(
			[1],
		);
	});

	it('document.write(x) を HTML 注入 sink として検出する', () => {
		expect(findTsSinkViolations('document.write(payload);').violations).toEqual([1]);
	});

	it('document.writeln(x) を検出する', () => {
		expect(findTsSinkViolations('document.writeln(payload);').violations).toEqual([1]);
	});

	it("bracket 記法 document['write'](x) も検出する", () => {
		expect(findTsSinkViolations("document['write'](payload);").violations).toEqual([1]);
	});

	it('logical assign innerHTML ??= x を検出する', () => {
		expect(findTsSinkViolations('el.innerHTML ??= fallbackHtml;').violations).toEqual([1]);
	});

	it('logical assign innerHTML ||= x を検出する', () => {
		expect(findTsSinkViolations('el.innerHTML ||= fallbackHtml;').violations).toEqual([1]);
	});

	it("bracket 記法でも比較演算 (el['innerHTML'] === x) は検出しない", () => {
		const content = [
			"if (el['innerHTML'] === '') { reset(); }",
			'if (el["outerHTML"] == raw) {}',
		].join('\n');
		expect(findTsSinkViolations(content).violations).toEqual([]);
	});

	it("bracket 記法の読み取り (const s = el['innerHTML'];) は検出しない", () => {
		expect(findTsSinkViolations("const snapshot = el['innerHTML'];").violations).toEqual([]);
	});

	it('document.write を含むコメント行は検出しない', () => {
		expect(findTsSinkViolations('// NG 例: document.write(x) は禁止').violations).toEqual([]);
	});

	it('writer.write(chunk) 等の document 以外の write 呼び出しは検出しない', () => {
		const content = ['writer.write(chunk);', 'stream.writeln(line);'].join('\n');
		expect(findTsSinkViolations(content).violations).toEqual([]);
	});

	it('bracket sink も allow-innerhtml: マーカー + sanitizer 実呼び出しで opt-out できる', () => {
		const content = [
			'const clean = DOMPurify.sanitize(raw);',
			'// allow-innerhtml: DOMPurify 済 (ADR-0025)',
			"el['innerHTML'] = clean;",
		].join('\n');
		expect(findTsSinkViolations(content)).toEqual({ violations: [], unsanitizedOptOuts: [] });
	});

	it('bracket sink の opt-out でも sanitizer 実呼び出しが無ければ違反 (#3450 item3 と同一原則)', () => {
		const content = ['// allow-innerhtml: 済のつもり', "el['innerHTML'] = raw;"].join('\n');
		expect(findTsSinkViolations(content)).toEqual({ violations: [], unsanitizedOptOuts: [2] });
	});
});
