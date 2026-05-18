// src/lib/features/reward-celebration/play-reward-celebration.ts
// #2158: ごほうび交換成立瞬間の感情演出 3 層 (視覚 + 触覚 + 聴覚)
//
// 設計原則:
// - ADR-0012 Anti-engagement: 演出時間 1-2 秒以内で完了、滞在延伸させない
// - ADR-0014 OSS 先調査: canvas-confetti (24k stars, 5KB gzipped, MIT) 採用
// - 既存 soundService (`$lib/ui/sound`) を活用、新規サウンドファイル追加なし
//   - `purchase` (ショップ購入) と `special-reward` (特別報酬) を順次再生
// - Vibration API は navigator.vibrate ガード付きでモバイルのみ発火 (200ms 単発)
// - SSR 互換: 動的 import + browser ガードで サーバーサイドビルド時の参照を回避
//
// 関連 Issue: #2154 EPIC / #2158 RS-4

import { browser } from '$app/environment';
import { soundService } from '$lib/ui/sound';

interface CelebrationOptions {
	/** 視覚演出を発火するか (デフォルト true) */
	confetti?: boolean;
	/** 触覚演出 (Vibration API) を発火するか (デフォルト true、モバイルのみ実発火) */
	vibrate?: boolean;
	/** 聴覚演出 (効果音) を発火するか (デフォルト true) */
	sound?: boolean;
}

/**
 * ごほうび交換成立瞬間の感情演出 3 層を発火する。
 *
 * - 視覚: canvas-confetti で 1-2 秒の紙吹雪 (ADR-0012 滞在延伸禁止に従う)
 * - 触覚: navigator.vibrate(200) でモバイルのみ短く震動
 * - 聴覚: soundService 経由で `purchase` (即) + `special-reward` (300ms 後) を順次再生
 *
 * SSR 環境では何もしない。canvas-confetti は動的 import で SSR ビルドから除外する。
 *
 * @param options 各演出層の ON/OFF 切替
 * @returns 演出 trigger の完了 Promise (動的 import 解決まで待つ)
 */
export async function playRewardCelebration(options: CelebrationOptions = {}): Promise<void> {
	if (!browser) return;

	const { confetti: confettiEnabled = true, vibrate = true, sound = true } = options;

	// 1. 聴覚: 即座に発火 (user gesture 直後のため AudioContext 制約に抵触しない)
	if (sound) {
		try {
			soundService.ensureContext();
			soundService.play('purchase');
			// 特別報酬音は購入音と重ならないよう 300ms 遅延
			setTimeout(() => {
				soundService.play('special-reward');
			}, 300);
		} catch {
			// silent fallback
		}
	}

	// 2. 触覚: モバイル端末のみ navigator.vibrate(200) で短く震動
	if (vibrate && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
		try {
			navigator.vibrate(200);
		} catch {
			// silent fallback (一部ブラウザで permission denied)
		}
	}

	// 3. 視覚: canvas-confetti を動的 import (SSR ビルド除外 + lazy load)
	if (confettiEnabled) {
		try {
			const { default: confetti } = await import('canvas-confetti');
			// 1 秒以内に完結する紙吹雪 (ADR-0012 整合)
			// - particleCount: 80 (過剰でない適度な量)
			// - spread: 70 (画面中央上に拡散)
			// - origin.y: 0.6 (画面やや上から発火)
			confetti({
				particleCount: 80,
				spread: 70,
				origin: { y: 0.6 },
				ticks: 100, // ~1.5 秒で消滅
				disableForReducedMotion: true, // prefers-reduced-motion 尊重
			});
		} catch {
			// silent fallback (canvas-confetti load 失敗時)
		}
	}
}
