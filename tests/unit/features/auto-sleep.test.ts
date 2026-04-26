// tests/unit/features/auto-sleep.test.ts
// #1292 自動スリープ — タイマーロジック単体テスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAutoSleep } from '$lib/features/auto-sleep';

describe('startAutoSleep', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('15分連続アクティブで onSleep が呼ばれる', () => {
		const onSleep = vi.fn();
		const cleanup = startAutoSleep({
			activeMs: 15 * 60 * 1000,
			inactiveResetMs: 60 * 1000,
			battleGraceMs: 2 * 60 * 1000,
			onSleep,
			getPathname: () => '/preschool/home',
			getHidden: () => false,
		});

		// 30秒ごとにアクティビティを送信しながら15分+1tick経過
		for (let elapsed = 0; elapsed < 15 * 60 * 1000 + 1000; elapsed += 30 * 1000) {
			window.dispatchEvent(new Event('pointerdown'));
			vi.advanceTimersByTime(30 * 1000);
		}

		expect(onSleep).toHaveBeenCalledOnce();
		cleanup();
	});

	it('非アクティブ1分でタイマーがリセットされる（onSleep が呼ばれない）', () => {
		const onSleep = vi.fn();
		const cleanup = startAutoSleep({
			activeMs: 15 * 60 * 1000,
			inactiveResetMs: 60 * 1000,
			battleGraceMs: 2 * 60 * 1000,
			onSleep,
			getPathname: () => '/preschool/home',
			getHidden: () => false,
		});

		// 14分アクティブ（30秒間隔）
		for (let elapsed = 0; elapsed < 14 * 60 * 1000; elapsed += 30 * 1000) {
			window.dispatchEvent(new Event('pointerdown'));
			vi.advanceTimersByTime(30 * 1000);
		}

		// 1分非アクティブ → accumulated リセット
		vi.advanceTimersByTime(60 * 1000 + 1000);

		// リセット後はまだ onSleep されていない
		expect(onSleep).not.toHaveBeenCalled();
		cleanup();
	});

	it('getHidden=true の場合は accumulated が増えない', () => {
		const onSleep = vi.fn();
		const cleanup = startAutoSleep({
			activeMs: 15 * 60 * 1000,
			inactiveResetMs: 60 * 1000,
			battleGraceMs: 2 * 60 * 1000,
			onSleep,
			getPathname: () => '/preschool/home',
			getHidden: () => true,
		});

		// 20分経過しても onSleep されない
		for (let elapsed = 0; elapsed < 20 * 60 * 1000; elapsed += 30 * 1000) {
			window.dispatchEvent(new Event('pointerdown'));
			vi.advanceTimersByTime(30 * 1000);
		}

		expect(onSleep).not.toHaveBeenCalled();
		cleanup();
	});

	it('バトル中は grace period (+2分) が加算される', () => {
		const onSleep = vi.fn();
		const cleanup = startAutoSleep({
			activeMs: 15 * 60 * 1000,
			inactiveResetMs: 60 * 1000,
			battleGraceMs: 2 * 60 * 1000,
			onSleep,
			getPathname: () => '/elementary/battle/1',
			getHidden: () => false,
		});

		// 15分アクティブでは onSleep されない（grace期間中）
		for (let elapsed = 0; elapsed < 15 * 60 * 1000 + 1000; elapsed += 30 * 1000) {
			window.dispatchEvent(new Event('pointerdown'));
			vi.advanceTimersByTime(30 * 1000);
		}
		expect(onSleep).not.toHaveBeenCalled();

		// さらに2分+1tick で onSleep
		for (let elapsed = 0; elapsed < 2 * 60 * 1000 + 1000; elapsed += 30 * 1000) {
			window.dispatchEvent(new Event('pointerdown'));
			vi.advanceTimersByTime(30 * 1000);
		}
		expect(onSleep).toHaveBeenCalledOnce();
		cleanup();
	});

	it('cleanup() を呼ぶとタイマーが停止する', () => {
		const onSleep = vi.fn();
		const cleanup = startAutoSleep({
			activeMs: 15 * 60 * 1000,
			inactiveResetMs: 60 * 1000,
			battleGraceMs: 2 * 60 * 1000,
			onSleep,
			getPathname: () => '/preschool/home',
			getHidden: () => false,
		});

		// 14分アクティブ
		for (let elapsed = 0; elapsed < 14 * 60 * 1000; elapsed += 30 * 1000) {
			window.dispatchEvent(new Event('pointerdown'));
			vi.advanceTimersByTime(30 * 1000);
		}

		cleanup(); // クリーンアップ

		// さらに2分経過しても onSleep されない
		vi.advanceTimersByTime(2 * 60 * 1000);
		expect(onSleep).not.toHaveBeenCalled();
	});
});
