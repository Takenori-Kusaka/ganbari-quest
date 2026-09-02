// tests/unit/domain/child-nav-age-tier-kana.test.ts (#4715 QM)
//
// docs/DESIGN.md §8: baby (0-2 歳 = 親の準備モード) / preschool (3-5 歳) は漢字を読めない。
// 子供ナビのラベルは年齢モードごとに用意されているが、**漢字が混ざっていないことを
// 機械で見ている検査が無かった**ため、SSOT 集約や呼称統一のたびに漢字が紛れ込みうる。
//
// カタカナは対象外にする: 「チャレンジ」「チェックリスト」のような外来語には自然な
// ひらがな表記が無く、幼児向け教材でもカタカナで表記される。読めない文字種は漢字。

import { describe, expect, it } from 'vitest';
import { getChildNavModeLabels } from '../../../src/lib/domain/labels';

const KANJI = /[\u4e00-\u9fff]/;

describe('#4715 子供ナビの年齢モード別ラベル (docs/DESIGN.md §8)', () => {
	it('baby / preschool のナビラベルに漢字が混ざらない', () => {
		for (const mode of ['baby', 'preschool']) {
			const labels = getChildNavModeLabels(mode);
			for (const [key, value] of Object.entries(labels)) {
				expect(KANJI.test(value), `${mode}.${key} に漢字が入っている: ${value}`).toBe(false);
			}
		}
	});

	it('junior / senior は漢字表記を使う (幼児向け語彙に引きずられない)', () => {
		for (const mode of ['junior', 'senior']) {
			const labels = getChildNavModeLabels(mode);
			const values = Object.values(labels);
			expect(
				values.some((v) => KANJI.test(v)),
				`${mode} が全てひらがな / カタカナになっている: ${values.join(' / ')}`,
			).toBe(true);
		}
	});

	it('全モードで key の集合が一致する (片方だけ増えて undefined にならない)', () => {
		const base = Object.keys(getChildNavModeLabels('elementary')).sort();
		for (const mode of ['baby', 'preschool', 'junior', 'senior']) {
			expect(Object.keys(getChildNavModeLabels(mode)).sort(), `${mode} の key 集合`).toEqual(base);
		}
	});
});
