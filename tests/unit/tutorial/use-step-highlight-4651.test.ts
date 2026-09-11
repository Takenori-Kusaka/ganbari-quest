// tests/unit/tutorial/use-step-highlight-4651.test.ts (#4651 QM)
//
// #4651 の付随不具合 d: タイムアウト (既定 3 秒) で監視まで止めていたため、ページ遷移が
// 3 秒を超えると以後ずっと中央 fallback のままだった。監視を続けて後から現れた要素を
// spotlight に昇格させる、という**変更後の契約をここで固定する**。
//
// 「監視を止めない」= 無期限ではない。停止は signal の abort (step 変更 / ガイド終了) が行う。
// leak しないことも同時に固定する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForElement } from '../../../src/lib/ui/tutorial/useStepHighlight.svelte';

/** 幅・高さを持つ (= findVisibleElement が拾える) 要素を body に足す。 */
function appendVisible(id: string): HTMLElement {
	const el = document.createElement('div');
	el.id = id;
	Object.defineProperty(el, 'getBoundingClientRect', {
		value: () => ({ width: 100, height: 20, top: 0, left: 0, bottom: 20, right: 100 }),
	});
	document.body.appendChild(el);
	return el;
}

beforeEach(() => {
	vi.useFakeTimers();
	document.body.innerHTML = '';
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('#4651 waitForElement: タイムアウト後も監視を続ける', () => {
	it('時間内に現れなければ onFallback が呼ばれる', () => {
		const callback = vi.fn();
		const onFallback = vi.fn();
		const ac = new AbortController();

		waitForElement('#late', callback, ac.signal, onFallback, 3000);
		vi.advanceTimersByTime(3000);

		expect(onFallback, 'fallback で「対象なし」を伝える').toHaveBeenCalledTimes(1);
		expect(callback, 'まだ要素は無いので spotlight は張らない').not.toHaveBeenCalled();
		ac.abort();
	});

	it('タイムアウト後に現れた要素でも spotlight に昇格する (不具合 d の回帰)', async () => {
		const callback = vi.fn();
		const onFallback = vi.fn();
		const ac = new AbortController();

		waitForElement('#late', callback, ac.signal, onFallback, 3000);
		vi.advanceTimersByTime(3000);
		expect(onFallback).toHaveBeenCalledTimes(1);

		// 3 秒より後に DOM へ出現させる (遅いページ遷移の再現)
		appendVisible('late');
		await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1), { timeout: 2000 });

		ac.abort();
	});

	it('abort 後は要素が現れても callback を呼ばない (監視は step 寿命で切れる)', async () => {
		const callback = vi.fn();
		const onFallback = vi.fn();
		const ac = new AbortController();

		waitForElement('#late', callback, ac.signal, onFallback, 3000);
		vi.advanceTimersByTime(3000);
		ac.abort();

		appendVisible('late');
		// fake timer 下なので実 setTimeout は待てない。MutationObserver の microtask だけ流す。
		await Promise.resolve();
		await Promise.resolve();
		vi.advanceTimersByTime(1000);

		expect(callback, 'abort 後に spotlight を張ってはいけない').not.toHaveBeenCalled();
	});

	it('abort すると timer も止まる (fallback が後から発火しない)', () => {
		const onFallback = vi.fn();
		const ac = new AbortController();

		waitForElement('#never', vi.fn(), ac.signal, onFallback, 3000);
		ac.abort();
		vi.advanceTimersByTime(10_000);

		expect(onFallback).not.toHaveBeenCalled();
	});
});
