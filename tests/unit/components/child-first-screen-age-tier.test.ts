// tests/unit/components/child-first-screen-age-tier.test.ts
//
// 初回訪問の子供が最初に見る 2 面 — 冒険スタート演出 (`AdventureStartOverlay`) と
// 活動 0 件の空状態 (`ActivityEmptyState`) — は年齢帯を持たない平坦な定数を読んでいた。
// `FULL_FEATURES.showAdventureStart` は elementary / junior / senior に付いているので、
// 16-18 歳が受け取る最初の 1 画面が「やあ！ / きょうから いっしょに ぼうけんだよ！ /
// したのカードをタップしてみてね」という幼児文体になっていた (docs/DESIGN.md §8)。
//
// さらに overlay の表示条件 (`showAdventureStart && isFirstTime`) とカード一覧の分岐
// (`activities.length`) は独立しているため、活動 0 件のときは「したのカードをタップ
// してみてね」と言いながら押すカードが 1 枚も無い状態が起きていた。
//
// 固定する不変条件 (labels の resolver だけでなく **実際に描画される文字列**):
//   [A] junior / senior の初回演出が漢字文体になる (prop 配線の抜けを検出する)
//   [B] 活動 0 件のときは「したのカード」を指さない
//   [C] 活動 0 件の空状態も年齢帯で切り替わる

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getChildActivityEmptyLabels,
	getChildAdventureStartLabels,
} from '../../../src/lib/domain/labels';
import ActivityEmptyState from '../../../src/lib/ui/components/ActivityEmptyState.svelte';
import AdventureStartOverlay from '../../../src/lib/ui/components/AdventureStartOverlay.svelte';

vi.mock('../../../src/lib/ui/sound', () => ({
	soundService: { play: vi.fn(), playRecordComplete: vi.fn(), configure: vi.fn() },
}));

afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

const HIRAGANA_MODES = ['baby', 'preschool', 'elementary'] as const;
const KANJI_MODES = ['junior', 'senior'] as const;

/**
 * 冒険スタート演出は phase 0→4 を setTimeout で進める。最終 phase (8000ms) まで
 * 進めてから、`document.body` 全体 (Dialog は portal 配下) の文字列を返す。
 */
async function renderOverlayFinalPhase(uiMode: string, hasActivities: boolean): Promise<string> {
	vi.useFakeTimers();
	render(AdventureStartOverlay as never, {
		props: { open: true, childName: 'たろう', uiMode, hasActivities } as never,
	});
	await vi.advanceTimersByTimeAsync(8100);
	return document.body.textContent ?? '';
}

describe('[A] 初回の冒険スタート演出が年齢帯で切り替わる', () => {
	it('junior / senior は漢字文体になり、幼児向けひらがなが残らない', async () => {
		for (const uiMode of KANJI_MODES) {
			const text = await renderOverlayFinalPhase(uiMode, true);
			const t = getChildAdventureStartLabels(uiMode);
			expect(text, uiMode).toContain(t.adventureReadyText);
			expect(text, uiMode).toContain(t.adventureStartBtn);
			// 旧実装が出していた幼児文体
			expect(text, uiMode).not.toContain('したのカードをタップしてみてね');
			expect(text, uiMode).not.toContain('ぼうけんスタート！');
			cleanup();
		}
	});

	it('baby / preschool / elementary は従来どおりひらがなのまま', async () => {
		for (const uiMode of HIRAGANA_MODES) {
			const text = await renderOverlayFinalPhase(uiMode, true);
			expect(text, uiMode).toContain('したのカードをタップしてみてね');
			expect(text, uiMode).toContain('ぼうけんスタート！');
			cleanup();
		}
	});
});

describe('[B] 活動 0 件のとき「下のカード」を指さない', () => {
	it('hasActivities=false では押すカードを案内しない (5 年齢モード)', async () => {
		for (const uiMode of [...HIRAGANA_MODES, ...KANJI_MODES]) {
			const text = await renderOverlayFinalPhase(uiMode, false);
			const t = getChildAdventureStartLabels(uiMode);
			expect(text, uiMode).toContain(t.adventureReadySubEmpty);
			expect(text, uiMode).not.toContain(t.adventureReadySub);
			cleanup();
		}
	});

	it('hasActivities=true では従来どおりカードを案内する', async () => {
		const text = await renderOverlayFinalPhase('elementary', true);
		const t = getChildAdventureStartLabels('elementary');
		expect(text).toContain(t.adventureReadySub);
		expect(text).not.toContain(t.adventureReadySubEmpty);
	});
});

describe('[C] 活動 0 件の空状態が年齢帯で切り替わる', () => {
	function renderEmpty(uiMode: string): string {
		render(ActivityEmptyState as never, { props: { uiMode } as never });
		return screen.getByTestId('activity-empty-state').textContent ?? '';
	}

	it('junior / senior は漢字文体になる', () => {
		for (const uiMode of KANJI_MODES) {
			const text = renderEmpty(uiMode);
			const t = getChildActivityEmptyLabels(uiMode);
			expect(text, uiMode).toContain(t.activityEmptyTitle);
			expect(text, uiMode).toContain(t.activityEmptyDesc);
			expect(text, uiMode).not.toContain('ぼうけんの じゅんびちゅう');
			expect(text, uiMode).not.toContain('もうすこし まってね');
			cleanup();
		}
	});

	it('baby / preschool / elementary は従来どおりひらがなのまま', () => {
		for (const uiMode of HIRAGANA_MODES) {
			const text = renderEmpty(uiMode);
			expect(text, uiMode).toContain('ぼうけんの じゅんびちゅう');
			expect(text, uiMode).toContain('もうすこし まってね');
			cleanup();
		}
	});
});
