// tests/unit/components/child-xp-gain-row.test.ts
// #4509 ①: 記録結果ダイアログの経験値表示が「実際に増えた分」であることを固定する。
//
// ## 旧実装の何が壊れていたか
//
// 結果ダイアログは xpGain (xpBefore / xpAfter) を手元に持ちながら、経験値の増分を
// `+0.3` という**固定リテラル**で描画していた。子供が 5 ポイントの活動を記録しても
// 20 ポイントの活動を記録しても、画面には常に同じ「+0.3」が出る。
// 実際の増分は整数 (= 獲得ポイント) なので、桁も値も実データと一致しない。
//
// 子供の信頼はプロダクトの核 (がんばった結果が正しく映ること) なので、
// 「表示された数字 = 実際に増えた経験値」をここで固定する。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import XpGainRow from '../../../src/lib/features/child-home/components/XpGainRow.svelte';

afterEach(() => cleanup());

const BASE = {
	categoryId: 1,
	categoryName: 'うんどう',
	maxValue: 100000,
	levelBefore: 3,
	levelAfter: 3,
} as const;

function renderRow(overrides: Record<string, unknown>) {
	// biome-ignore lint/suspicious/noExplicitAny: XpGainInfo を test 用に最小構成で渡す
	render(XpGainRow as never, { props: { xp: { ...BASE, ...overrides } } as any });
	return screen.getByTestId('result-xp-delta');
}

describe('#4509 ① 記録結果ダイアログの経験値表示', () => {
	it('実際の増分 (xpAfter - xpBefore) を表示する', () => {
		expect(renderRow({ xpBefore: 12, xpAfter: 20 }).textContent).toBe('+8');
	});

	it('増分が違えば表示も変わる — 固定リテラルではない', () => {
		const first = renderRow({ xpBefore: 0, xpAfter: 5 }).textContent;
		cleanup();
		const second = renderRow({ xpBefore: 0, xpAfter: 30 }).textContent;
		expect(first).toBe('+5');
		expect(second).toBe('+30');
		expect(first).not.toBe(second);
	});

	it('桁区切りが必要な増分もそのまま実データを出す', () => {
		expect(renderRow({ xpBefore: 1000, xpAfter: 2500 }).textContent).toBe('+1,500');
	});

	it('「+0.3」という固定値は二度と描画しない (回帰 guard)', () => {
		const row = renderRow({ xpBefore: 12, xpAfter: 20 });
		expect(row.textContent).not.toContain('0.3');
	});

	it('レベルが上がった回はレベルアップ表示も併記する', () => {
		renderRow({ xpBefore: 90, xpAfter: 110, levelBefore: 3, levelAfter: 4 });
		expect(screen.getByTestId('result-xp-levelup').textContent).toContain('4');
	});

	it('レベルが変わらない回はレベルアップ表示を出さない', () => {
		renderRow({ xpBefore: 12, xpAfter: 20 });
		expect(screen.queryByTestId('result-xp-levelup')).toBeNull();
	});
});
