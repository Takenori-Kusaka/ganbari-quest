// tests/unit/features/parent-gate-inactivity.test.ts
// 親管理画面 inactivity redirect タイマーの単体テスト。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	PARENT_GATE_INACTIVITY_MS,
	startParentGateInactivityRedirect,
} from '../../../src/lib/features/admin/parent-gate-inactivity';

describe('startParentGateInactivityRedirect', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('既定 timeout は 15 分 (server INACTIVITY_TIMEOUT_MS と一致)', () => {
		expect(PARENT_GATE_INACTIVITY_MS).toBe(15 * 60 * 1000);
	});

	it('timeoutMs アイドルで onTimeout を 1 度だけ発火する', () => {
		let now = 0;
		const onTimeout = vi.fn();
		const cleanup = startParentGateInactivityRedirect({
			timeoutMs: 1000,
			tickMs: 100,
			onTimeout,
			getNow: () => now,
		});

		// まだアイドルでない
		now = 500;
		vi.advanceTimersByTime(500);
		expect(onTimeout).not.toHaveBeenCalled();

		// timeout 到達
		now = 1000;
		vi.advanceTimersByTime(500);
		expect(onTimeout).toHaveBeenCalledTimes(1);

		// その後も再発火しない (1 度だけ)
		now = 5000;
		vi.advanceTimersByTime(2000);
		expect(onTimeout).toHaveBeenCalledTimes(1);

		cleanup();
	});

	it('操作 (keydown) で lastActive がリセットされ onTimeout が発火しない', () => {
		let now = 0;
		const onTimeout = vi.fn();
		const cleanup = startParentGateInactivityRedirect({
			timeoutMs: 1000,
			tickMs: 100,
			onTimeout,
			getNow: () => now,
		});

		// 900ms 経過後に操作 → lastActive=900 にリセット
		now = 900;
		window.dispatchEvent(new KeyboardEvent('keydown'));
		vi.advanceTimersByTime(900);

		// 操作から 999ms (= now 1899) ではまだ未発火
		now = 1899;
		vi.advanceTimersByTime(999);
		expect(onTimeout).not.toHaveBeenCalled();

		// 操作から 1000ms (= now 1900) で発火
		now = 1900;
		vi.advanceTimersByTime(1);
		expect(onTimeout).toHaveBeenCalledTimes(1);

		cleanup();
	});

	it('cleanup でタイマーが停止し以後発火しない', () => {
		let now = 0;
		const onTimeout = vi.fn();
		const cleanup = startParentGateInactivityRedirect({
			timeoutMs: 1000,
			tickMs: 100,
			onTimeout,
			getNow: () => now,
		});

		cleanup();
		now = 5000;
		vi.advanceTimersByTime(5000);
		expect(onTimeout).not.toHaveBeenCalled();
	});
});
