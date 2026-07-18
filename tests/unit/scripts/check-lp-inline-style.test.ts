/**
 * tests/unit/scripts/check-lp-inline-style.test.ts (#3766)
 *
 * `scripts/check-lp-inline-style.mjs` の `ZERO_AUTO_ONLY_RE` (CodeQL js/redos 修正) の
 * regression guard。
 *
 * 背景 (CodeQL js/redos): 旧 `/^(\s*(0|auto)\s*)+$/` は繰り返しグループ内の先頭・末尾 `\s*` が
 * 隣接反復とマッチ範囲を奪い合い、非マッチ入力で catastrophic backtracking (ReDoS) を起こす。
 * 修正版 `/^\s*(?:0|auto)(?:\s+(?:0|auto))*\s*$/` はトークン間 whitespace を必須 `\s+` に固定し、
 * 前後 trim を 1 回きりにすることで linear-time な等価パターンにする。
 *
 * 判別力 (mutation → fail):
 *   - 等価性: 旧 regex は `00` / `0auto` を「0 と 0」「0 と auto」の連続として match するが、
 *     修正版は空白区切りを必須とするため reject する。旧 regex に戻すと下記 reject assert が fail する
 *     (実測: 旧 `/^(\s*(0|auto)\s*)+$/.test('00')` = true / 修正版 = false)。
 *   - 線形性: 旧 regex に戻すと 50000 空白 + 'x' で catastrophic backtracking し、線形性 assert が
 *     timeout / 超過で fail する。
 */

import { describe, expect, it } from 'vitest';
import { isAllowedValue, ZERO_AUTO_ONLY_RE } from '../../../scripts/check-lp-inline-style.mjs';

describe('ZERO_AUTO_ONLY_RE (#3766 js/redos guard)', () => {
	it('(a) 等価性: 空白区切りの 0 / auto 列を許容する', () => {
		for (const s of ['0', 'auto', '0 auto', 'auto 0', '0 0', 'auto auto', '  0   auto  ']) {
			expect(ZERO_AUTO_ONLY_RE.test(s)).toBe(true);
		}
	});

	it('(a) 等価性: 空白区切りなし連結 (00 / 0auto) を reject する (旧実装との微小差を pin)', () => {
		// 旧 `/^(\s*(0|auto)\s*)+$/` は `00` / `0auto` を match (allow) していたが、これは
		// 実 CSS では退化入力 (padding:00 等) で無害。修正版は空白区切り必須で reject する。
		// この差分こそが「旧 regex に戻したら fail する」mutation 判別点。
		for (const s of ['00', '0auto', 'auto0', 'autoauto']) {
			expect(ZERO_AUTO_ONLY_RE.test(s)).toBe(false);
		}
	});

	it('(a) 等価性: 数値単位 / 非該当値を reject する', () => {
		for (const s of ['1px', '0px', 'x', '', '10rem']) {
			expect(ZERO_AUTO_ONLY_RE.test(s)).toBe(false);
		}
	});

	it('(b) 線形性: 50000 空白 + 非マッチ末尾で即座に返る (ReDoS でない)', () => {
		// 旧 regex ならここで catastrophic backtracking により事実上停止する。
		// 修正版は linear で数 ms 以内に false を返す。
		const evil = `${' '.repeat(50000)}x`;
		const start = performance.now();
		const result = ZERO_AUTO_ONLY_RE.test(evil);
		const elapsedMs = performance.now() - start;
		expect(result).toBe(false);
		// 十分に緩い上限 (実測 < 1ms)。旧 regex に戻すと超過 / timeout する。
		expect(elapsedMs).toBeLessThan(1000);
	}, 5000);
});

describe('isAllowedValue (ZERO_AUTO_ONLY_RE 経由の許容判定、#3766)', () => {
	it('0 / auto 系は許容 (regex 経路が正しく配線されている)', () => {
		for (const v of ['0', 'auto', '0 auto', 'auto 0']) {
			expect(isAllowedValue(v)).toBe(true);
		}
	});

	it('var() / calc() / 特殊値は許容', () => {
		expect(isAllowedValue('var(--lp-section-padding-y)')).toBe(true);
		expect(isAllowedValue('calc(100% - 8px)')).toBe(true);
		expect(isAllowedValue('inherit')).toBe(true);
	});

	it('数値単位直書き (16px 等) は違反として非許容', () => {
		expect(isAllowedValue('16px')).toBe(false);
		expect(isAllowedValue('0 8px')).toBe(false);
	});
});
