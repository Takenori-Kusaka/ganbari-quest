// tests/unit/ui/status-bar-category-tone-4690.test.ts (#4690 F5)
//
// `/junior/status` `/senior/status` はレーダーチャートのカテゴリ名を漢字にしたのに、
// その直下の一覧 (StatusBar) だけ `CATEGORIES[code].name` を直接読んでいて
// 「うんどう Lv.18」のままだった = 同一画面の中で文体が割れる (docs/DESIGN.md §8)。
// 値ではなく「その年齢帯で出てはいけない表記が出ない」ことを描画結果で固定する。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { asCategoryId } from '../../../src/lib/domain/ids';
import { getCategoryDisplayName } from '../../../src/lib/domain/labels';
import StatusBar from '../../../src/lib/ui/components/StatusBar.svelte';

const UNDOU = asCategoryId(1);
const BASE_PROPS = { categoryId: UNDOU, value: 42, level: 18 };

describe('#4690 F5: StatusBar のカテゴリ名が年齢帯に従う', () => {
	afterEach(() => cleanup());

	it('junior は漢字表記で描画する（ひらがな変種が残らない）', () => {
		render(StatusBar, { ...BASE_PROPS, uiMode: 'junior' });
		expect(screen.getByText(getCategoryDisplayName(UNDOU, 'junior'))).toBeTruthy();
		expect(screen.queryByText(getCategoryDisplayName(UNDOU, 'preschool'))).toBeNull();
	});

	it('senior は漢字表記で描画する（ひらがな変種が残らない）', () => {
		render(StatusBar, { ...BASE_PROPS, uiMode: 'senior' });
		expect(screen.getByText(getCategoryDisplayName(UNDOU, 'senior'))).toBeTruthy();
		expect(screen.queryByText(getCategoryDisplayName(UNDOU, 'preschool'))).toBeNull();
	});

	it('preschool は従来どおりひらがなのまま（漢字変種が漏れていない）', () => {
		render(StatusBar, { ...BASE_PROPS, uiMode: 'preschool' });
		expect(screen.getByText(getCategoryDisplayName(UNDOU, 'preschool'))).toBeTruthy();
		expect(screen.queryByText(getCategoryDisplayName(UNDOU, 'senior'))).toBeNull();
	});

	it('uiMode 未指定でもひらがな側に落ちる（既存の呼び出しを壊さない既定値）', () => {
		render(StatusBar, { ...BASE_PROPS });
		expect(screen.getByText(getCategoryDisplayName(UNDOU, 'preschool'))).toBeTruthy();
	});
});
