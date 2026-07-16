// tests/unit/ui/story-play-helpers.test.ts
// #3687 — Menu.stories / OverflowMenu.stories の play が CI でのみ
// 「pointer-events: none」で fail する timing flake の根治検証。
//
// stories 側は `waitFor(() => assertPointerInteractive(item))` で Ark UI Menu の
// open transition 完了 (= pointer-events 解除) を待つ。本 test は CI 相当の描画遅延を
// setTimeout で注入し、遅延の大小に依らず wait 条件が決定的に成立する (AC1) ことを
// jsdom で検証する。固定待ち (waitForTimeout) ではなく条件 poll であることの証跡。

import { waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { assertPointerInteractive } from '../../../src/lib/ui/primitives/story-play-helpers';

function createElement(pointerEvents: string): HTMLElement {
	const el = document.createElement('div');
	el.style.pointerEvents = pointerEvents;
	document.body.appendChild(el);
	return el;
}

describe('assertPointerInteractive (#3687 Menu play flake 根治)', () => {
	it('pointer-events: none (open transition 中) は throw する — waitFor の retry 対象になる', () => {
		const el = createElement('none');
		expect(() => assertPointerInteractive(el)).toThrowError(/pointer-events: none/);
		el.remove();
	});

	it('pointer-events 解除済 (transition 完了) は throw しない', () => {
		const el = createElement('auto');
		expect(() => assertPointerInteractive(el)).not.toThrow();
		el.remove();
	});

	it('[遅延注入] CI 相当の遅い transition 完了でも waitFor + assert で決定的に pass する (AC1)', async () => {
		// CI runner の遅い描画を模擬: 開始時は pointer-events: none、遅延後に解除される。
		const el = createElement('none');
		setTimeout(() => {
			el.style.pointerEvents = 'auto';
		}, 120);
		// stories と同一の合成 (waitFor は条件成立まで poll): 遅延量に依らず決定的に resolve する。
		await waitFor(() => assertPointerInteractive(el));
		expect(getComputedStyle(el).pointerEvents).not.toBe('none');
		el.remove();
	});
});
