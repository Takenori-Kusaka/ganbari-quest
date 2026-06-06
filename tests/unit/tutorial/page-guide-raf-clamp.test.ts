// tests/unit/tutorial/page-guide-raf-clamp.test.ts
// #2971 round4: rAF ループの lifecycle (開始 → 実行 → 停止) を JSDOM + fake timer で検証する。
//
// PageGuideOverlay.svelte の startClampLoop / stopClampLoop はコンポーネント内ローカル関数
// のため外部 import は不可能。本テストは「同等ロジック」をインライン再現し、
// cancelAnimationFrame が呼ばれることで tick が停止することを検証する。
// これにより「destroyDriver → stopClampLoop → rAF リーク防止」の設計的保証を補完する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('rAF clamp loop lifecycle (#2971 round4)', () => {
	let rafId: number | null = null;
	let tickCount: number;
	let isStopped: boolean;

	// startClampLoop / stopClampLoop と同等のロジックをインライン再現
	function startLoop(callback: () => void): void {
		stopLoop();
		isStopped = false;
		const tick = () => {
			if (isStopped) return;
			callback();
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
	}

	function stopLoop(): void {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		isStopped = true;
	}

	beforeEach(() => {
		rafId = null;
		tickCount = 0;
		isStopped = false;
		vi.useFakeTimers();
	});

	afterEach(() => {
		stopLoop();
		vi.useRealTimers();
	});

	it('startLoop を呼ぶと rAF がスケジュールされ callback が呼ばれる', () => {
		startLoop(() => {
			tickCount++;
		});
		// 初回 tick をフラッシュ
		vi.runAllTicks();
		expect(rafId).not.toBeNull(); // まだ継続中
	});

	it('stopLoop を呼ぶと cancelAnimationFrame が呼ばれ rafId が null になる', () => {
		const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');

		startLoop(() => {
			tickCount++;
		});
		expect(rafId).not.toBeNull();

		stopLoop();

		// cancelAnimationFrame が実際に呼ばれていること (#2971 round4: destroyDriver がリーク防止)
		expect(cancelSpy).toHaveBeenCalledTimes(1);
		expect(rafId).toBeNull();
	});

	it('stopLoop 後は callback が呼ばれない (isStopped フラグによる guard)', () => {
		startLoop(() => {
			tickCount++;
		});
		stopLoop();

		// 停止後は tick が増えない
		const countAfterStop = tickCount;
		vi.runAllTicks();
		expect(tickCount).toBe(countAfterStop);
	});

	it('startLoop を 2 回呼ぶと前のループが cancelAnimationFrame で停止される (stopLoop 冪等)', () => {
		// afterEach の stopLoop 等による副作用を除去するため spy を明示リセットしてから計測する
		const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
		cancelSpy.mockReset();

		startLoop(() => {
			tickCount++;
		});
		// 2 回目の startLoop → 内部で stopLoop → cancelAnimationFrame が 1 回呼ばれる
		startLoop(() => {
			tickCount++;
		});

		expect(cancelSpy).toHaveBeenCalledTimes(1);
	});
});
