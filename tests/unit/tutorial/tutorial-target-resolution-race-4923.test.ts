// tests/unit/tutorial/tutorial-target-resolution-race-4923.test.ts
// #4923: 本番の子供 ❓ ガイドが 5 step すべて中央 fallback (data-tutorial-target=fallback) になる。
//
// 対象要素は DOM に実在し可視 (PO 実測) なのに resolve できない。再現条件の仮説:
// `(child)/+layout.svelte` の 60 秒ごとの自動リロード (`invalidateAll()`) がガイド表示中も
// 止まらず (TutorialOverlay は `[data-scope="dialog"]` を持たないため autoReload の dialog-guard
// に引っかからない)、home `+page.svelte` の `$effect` が `data` の参照変化のたびに
// `setChildActivityPresence()` を cleanup→再実行し、`hasActivitiesKnown` を書き直す。
// `activeChapters` ($derived) は `chapterBuilder(hasActivitiesKnown)` の**新しい配列**を返すため、
// 値が変わらなくても `getCurrentStep()` は毎回 **新しい object 参照**の step を返す。
// Svelte 5 の `$effect` は依存する $derived の参照が変われば再実行するため、
// `setupStepTracking()` の効果が対象解決の途中で abort → 再試行になり、
// 解決の完了 (rAF → onFocus → scrollIntoView → rAF → setTimeout 300ms → targetResolved=true) を
// 挟むタイミングで再発火し続けると、この tick の解決が永遠に完走しない。
//
// 本 test は `hasActivitiesKnown` を書き直す store 操作 (home page の effect が本番で行うのと
// 同じ操作) を、対象解決の**進行中**に割り込ませ、`targetResolved` が最終的に `true` になる
// かどうかを確定させる。

import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
}));

globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;

import TutorialOverlay from '../../../src/lib/ui/components/TutorialOverlay.svelte';
import { makeChildChapterBuilder } from '../../../src/lib/ui/tutorial/tutorial-chapters-child';
import {
	endTutorial,
	setChildActivityPresence,
	setChildChapterBuilder,
	startTutorial,
} from '../../../src/lib/ui/tutorial/tutorial-store.svelte';

afterEach(() => {
	cleanup();
	endTutorial();
});

/** 対象要素の getBoundingClientRect を non-zero に固定する (jsdom は常に 0 を返すため)。 */
function stubVisibleRect(el: Element) {
	// biome-ignore lint/suspicious/noExplicitAny: jsdom の DOMRect stub
	(el as any).getBoundingClientRect = () => ({
		x: 10,
		y: 100,
		top: 100,
		left: 10,
		right: 90,
		bottom: 140,
		width: 80,
		height: 40,
		toJSON() {
			return this;
		},
	});
}

describe('#4923 ガイド対象解決レース (invalidateAll churn)', () => {
	beforeEach(() => {
		// jsdom は scrollIntoView / getAnimations / animate 未実装
		Element.prototype.scrollIntoView = vi.fn();
		// biome-ignore lint/suspicious/noExplicitAny: jsdom 未実装 API の stub
		(Element.prototype as any).getAnimations = () => [];
		// biome-ignore lint/suspicious/noExplicitAny: jsdom 未実装 API の stub
		(Element.prototype as any).animate = () => ({
			finished: Promise.resolve(),
			cancel: () => {},
			addEventListener: () => {},
		});
		document.body.innerHTML = '<div data-tutorial="activity-card"></div>';
		const target = document.querySelector('[data-tutorial="activity-card"]');
		if (target) stubVisibleRect(target);
	});

	it('本番同型の配線 (setChildChapterBuilder + setChildActivityPresence) で単発 resolve する', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] });
		try {
			setChildChapterBuilder(makeChildChapterBuilder('elementary'), 'child:1:elementary');
			setChildActivityPresence(true);
			await startTutorial();

			render(TutorialOverlay, { props: {} });

			// waitForElement の rAF
			await vi.advanceTimersByTimeAsync(20);
			// focusElement 内 rAF + setTimeout(300)
			await vi.advanceTimersByTimeAsync(320);

			const overlay = document.querySelector('.tutorial-overlay');
			expect(overlay?.getAttribute('data-tutorial-target')).toBe('resolved');
		} finally {
			vi.useRealTimers();
		}
	});

	it('対象解決の途中で hasActivitiesKnown が書き直されると resolved に到達しない (#4923 再現)', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] });
		try {
			setChildChapterBuilder(makeChildChapterBuilder('elementary'), 'child:1:elementary');
			setChildActivityPresence(true);
			await startTutorial();

			render(TutorialOverlay, { props: {} });

			// waitForElement の existing 分岐: 最初の rAF が発火する直前に、
			// home page の $effect が invalidateAll 後の data 変化で行うのと同じ操作
			// (cleanup → 再実行) を割り込ませる。
			await vi.advanceTimersByTimeAsync(10);
			setChildActivityPresence(undefined); // 旧 effect の cleanup
			setChildActivityPresence(true); // 新 effect 本体 (値は変わらない)

			// 残りの resolve タイムラインを最後まで進める
			await vi.advanceTimersByTimeAsync(1000);

			const overlay = document.querySelector('.tutorial-overlay');
			// 期待値: 最終的には resolved に「戻る」べき (self-heal)。
			// 戻らず fallback のままなら、単発の churn だけで恒久的に壊れることが実証される。
			expect(overlay?.getAttribute('data-tutorial-target')).toBe('resolved');
		} finally {
			vi.useRealTimers();
		}
	});
});
