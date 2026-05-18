// tests/unit/features/reward-celebration.test.ts
// #2158: ごほうび交換成立瞬間の感情演出 3 層 (canvas-confetti + Vibration + 効果音)
//
// テスト対象: src/lib/features/reward-celebration/play-reward-celebration.ts
//
// 検証観点:
// - 視覚: canvas-confetti が dynamic import 経由で呼ばれる
// - 触覚: navigator.vibrate(200) が発火 (モバイル emulation) / undefined 環境では skip
// - 聴覚: soundService.play('purchase') / .play('special-reward') が呼ばれる
// - options で各層 ON/OFF できる
// - SSR 環境 (browser=false) では何もしない

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted で mock 用関数を巻き上げる (vi.mock の factory より先に評価される)
const mocks = vi.hoisted(() => ({
	confetti: vi.fn(),
	play: vi.fn(),
	ensureContext: vi.fn(),
	browserValue: { current: true },
}));

vi.mock('canvas-confetti', () => ({
	default: mocks.confetti,
}));

vi.mock('$lib/ui/sound', () => ({
	soundService: {
		play: mocks.play,
		ensureContext: mocks.ensureContext,
	},
}));

vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browserValue.current;
	},
}));

import { playRewardCelebration } from '$lib/features/reward-celebration';

describe('playRewardCelebration', () => {
	beforeEach(() => {
		mocks.browserValue.current = true;
		mocks.confetti.mockReset();
		mocks.play.mockReset();
		mocks.ensureContext.mockReset();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('default options で 3 層すべてが発火する', async () => {
		const vibrateMock = vi.fn();
		Object.defineProperty(navigator, 'vibrate', {
			configurable: true,
			value: vibrateMock,
		});

		await playRewardCelebration();

		// 聴覚: purchase (即時) + special-reward (300ms 後)
		expect(mocks.ensureContext).toHaveBeenCalledTimes(1);
		expect(mocks.play).toHaveBeenCalledWith('purchase');
		await vi.advanceTimersByTimeAsync(300);
		expect(mocks.play).toHaveBeenCalledWith('special-reward');

		// 触覚: navigator.vibrate(200)
		expect(vibrateMock).toHaveBeenCalledWith(200);

		// 視覚: confetti が呼ばれる
		expect(mocks.confetti).toHaveBeenCalledTimes(1);
		const arg = mocks.confetti.mock.calls[0]?.[0];
		expect(arg).toMatchObject({
			particleCount: 80,
			spread: 70,
			disableForReducedMotion: true,
		});
	});

	it('sound: false で 効果音が発火しない', async () => {
		await playRewardCelebration({ sound: false });
		expect(mocks.play).not.toHaveBeenCalled();
		expect(mocks.ensureContext).not.toHaveBeenCalled();
	});

	it('vibrate: false で Vibration が発火しない', async () => {
		const vibrateMock = vi.fn();
		Object.defineProperty(navigator, 'vibrate', {
			configurable: true,
			value: vibrateMock,
		});
		await playRewardCelebration({ vibrate: false });
		expect(vibrateMock).not.toHaveBeenCalled();
	});

	it('confetti: false で confetti が発火しない', async () => {
		await playRewardCelebration({ confetti: false });
		expect(mocks.confetti).not.toHaveBeenCalled();
	});

	it('navigator.vibrate が undefined の環境 (PC) でも crash しない', async () => {
		Object.defineProperty(navigator, 'vibrate', {
			configurable: true,
			value: undefined,
		});
		await expect(playRewardCelebration({ vibrate: true })).resolves.toBeUndefined();
	});

	it('SSR 環境 (browser=false) では何もしない', async () => {
		mocks.browserValue.current = false;
		const vibrateMock = vi.fn();
		Object.defineProperty(navigator, 'vibrate', {
			configurable: true,
			value: vibrateMock,
		});

		await playRewardCelebration();

		expect(mocks.play).not.toHaveBeenCalled();
		expect(vibrateMock).not.toHaveBeenCalled();
		expect(mocks.confetti).not.toHaveBeenCalled();
	});

	it('soundService.play が例外を投げても他層が動く', async () => {
		mocks.play.mockImplementation(() => {
			throw new Error('audio context closed');
		});
		await expect(playRewardCelebration()).resolves.toBeUndefined();
		expect(mocks.confetti).toHaveBeenCalledTimes(1);
	});
});
