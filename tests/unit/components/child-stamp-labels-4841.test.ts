// tests/unit/components/child-stamp-labels-4841.test.ts (#4841)
//
// ログインボーナスの受取 UI (押印演出 / ヘッダーのスタンプカード) は年齢帯を持たず、
// 13-18 歳にも「きょうはもうおしたよ！」「3にちれんぞく！」「やったね！」という幼児文体が
// 出ていた (docs/DESIGN.md §8)。labels の resolver だけでなく、**実際に描画される文字列**が
// 年齢帯で切り替わることを component 層で固定する (prop 配線の抜けを検出する)。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getChildStampLabels } from '../../../src/lib/domain/labels';
import StampCard from '../../../src/lib/ui/components/StampCard.svelte';

vi.mock('../../../src/lib/ui/sound', () => ({
	soundService: { play: vi.fn(), playRecordComplete: vi.fn(), configure: vi.fn() },
}));

afterEach(() => cleanup());

const BASE_PROPS = {
	weekStart: '2026-09-01',
	weekEnd: '2026-09-07',
	entries: [{ slot: 1, emoji: '🎋', name: 'まつ', rarity: 'N', omikujiRank: null }],
	totalSlots: 5,
	filledSlots: 1,
	status: 'collecting',
	redeemedPoints: null,
};

function renderCard(uiMode: string, overrides: Record<string, unknown> = {}) {
	render(StampCard as never, {
		props: { ...BASE_PROPS, canStampToday: false, uiMode, ...overrides } as never,
	});
	return screen.getByTestId('stamp-card').textContent ?? '';
}

describe('#4841 スタンプカード (ログインボーナス受取) の文言が年齢帯で切り替わる', () => {
	it('junior / senior は「きょうはもうおしたよ！」に着地しない', () => {
		for (const uiMode of ['junior', 'senior'] as const) {
			const text = renderCard(uiMode);
			expect(text, uiMode).toContain(getChildStampLabels(uiMode).stampCardStampedToday);
			expect(text, uiMode).not.toContain('おしたよ');
			cleanup();
		}
	});

	it('baby / preschool / elementary は従来どおりひらがな文体のまま', () => {
		for (const uiMode of ['baby', 'preschool', 'elementary'] as const) {
			const text = renderCard(uiMode);
			expect(text, uiMode).toContain('きょうはもうおしたよ');
			cleanup();
		}
	});

	it('交換済みの受取額表示も年齢帯で切り替わる (uiMode 未指定はひらがな側の既定)', () => {
		const senior = renderCard('senior', { status: 'redeemed', redeemedPoints: 80 });
		expect(senior).toContain('80pt 受け取り済み');
		expect(senior).not.toContain('もらったよ');
		cleanup();

		const preschool = renderCard('preschool', { status: 'redeemed', redeemedPoints: 80 });
		expect(preschool).toContain('80pt もらったよ！');
	});
});
