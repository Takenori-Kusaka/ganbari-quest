/**
 * tests/unit/scripts/escape-regexp.test.ts (#3766)
 *
 * `scripts/lib/ci/escape-regexp.mjs` の `escapeRegExp` の regression guard。
 *
 * 背景 (CodeQL js/incomplete-sanitization): リテラル文字列を `new RegExp()` に埋め込む際、
 * 一部のメタ文字だけを escape する部分サニタイズ (例: `.replace(/\./g, '\\.')` で `.` のみ) は
 * 意図しないマッチ / SyntaxError を招く。`escapeRegExp` は全メタ文字を 1 度に escape する。
 *
 * 判別力 (mutation → fail): `.`-only escape 等の部分実装に戻すと、`(` `[` `{` などは
 * escape されず `new RegExp()` が SyntaxError を throw する / `+` `*` `?` は量指定子として
 * 解釈されリテラルマッチが崩れるため、下記 per-char assert が fail する
 * (実測: 旧 `.`-only 実装で `new RegExp(escape('('))` は SyntaxError)。
 *
 * SSOT 統合 (#1442): 本 helper は `scripts/lib/ci/orphan-utils.mjs` の `escapeRegex` の
 * 実体でもある (orphan-utils が re-export)。旧 orphan-utils 実装との後方互換は
 * `scripts/__tests__/check-orphan-utils.test.mjs` の escapeRegex block が担保する。
 */

import { describe, expect, it } from 'vitest';
import { escapeRegExp } from '../../../scripts/lib/ci/escape-regexp.mjs';

/** 正規表現メタ文字の網羅集合 (敵対的入力)。 */
const META_CHARS = [
	'.',
	'*',
	'+',
	'?',
	'[',
	']',
	'(',
	')',
	'{',
	'}',
	'^',
	'$',
	'|',
	'\\',
	'/',
	'-',
];

describe('escapeRegExp (#3766 全メタ文字 escape guard)', () => {
	it('各メタ文字を単独で escape し、new RegExp がリテラルマッチする', () => {
		// 旧 `.`-only escape に戻すと `(` `[` `{` で SyntaxError、`+` `*` `?` で
		// マッチ崩れとなり、この loop が throw / fail する (mutation 判別)。
		for (const ch of META_CHARS) {
			const escaped = escapeRegExp(ch);
			// escape 後は必ず `\` が前置される。
			expect(escaped).toBe(`\\${ch}`);
			// literal として扱えることを実際の RegExp で確認 (throw しない + 自分自身にマッチ)。
			const re = new RegExp(`^${escaped}$`);
			expect(re.test(ch)).toBe(true);
		}
	});

	it('全メタ文字を連結した敵対的入力を literal match できる', () => {
		const adversarial = META_CHARS.join(''); // .*+?[](){}^$|\/-
		const escaped = escapeRegExp(adversarial);
		const re = new RegExp(`^${escaped}$`);
		expect(re.test(adversarial)).toBe(true);
		// 別文字列には誤マッチしない (量指定子として解釈されていない証跡)。
		expect(re.test(`${adversarial}x`)).toBe(false);
	});

	it('量指定メタ文字 (+ * ?) がリテラル化され「1 回以上」解釈にならない', () => {
		// 旧 `.`-only 実装では `a+` が「a 1 回以上」になり `a` 単体にマッチしてしまう。
		// 完全 escape では `a\+` = literal `a+` なので `a` 単体にはマッチしない。
		const escaped = escapeRegExp('a+b');
		const re = new RegExp(`^${escaped}$`);
		expect(re.test('a+b')).toBe(true);
		expect(re.test('aaab')).toBe(false);
		expect(re.test('ab')).toBe(false);
	});

	it('通常文字 (メタ文字なし) は無変換で返す', () => {
		expect(escapeRegExp('foobar123')).toBe('foobar123');
	});

	it('非文字列入力を String 化する (堅牢性)', () => {
		// @ts-expect-error 意図的に number を渡し String coercion を検証
		expect(escapeRegExp(42)).toBe('42');
	});

	it('実利用パターン: path 由来リテラルを埋め込んでも意図通りマッチする', () => {
		const filePath = 'scripts/lib/ci/escape-regexp.mjs';
		const re = new RegExp(escapeRegExp(filePath));
		expect(re.test(`error at ${filePath}: boom`)).toBe(true);
		// `.` がリテラル化されているので任意 1 文字には誤マッチしない。
		expect(re.test('scripts/lib/ci/escape-regexpXmjs')).toBe(false);
	});
});
