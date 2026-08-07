// src/lib/features/point-flight/point-flight.svelte.ts
// #4448: 記録 / 交換で動いたポイントを、ヘッダー残高までつなぐ演出の実行部。
//
// 「どう動かすか」だけを持ち、「動かすかどうか」は point-flight-plan.ts の純関数に委ねる。
//
// 全体の流れ (獲得の例):
//   1. 結果ダイアログのポイント数字の矩形を掴む (呼び出し側)
//   2. ヘッダー残高を「変化前の値」で hold する — invalidateAll() で無言で書き換わるのを止める
//   3. commit() (= invalidateAll) で新しい残高を取り込む
//   4. `+10P` の ghost を出発点からヘッダー残高の実座標へ飛ばす
//   5. ヘッダー残高を変化前 → 変化後へカウントアップして release
//
// ADR-0012 整合: 音 / confetti を足さない。合計 660ms。ghost は pointer-events:none で
// 操作をブロックしない (演出中に画面を離れられる)。

// カウントアップは `svelte/motion` の `Tween` ではなく rAF 直書きにしている。
// `svelte/motion` の index は module 評価時に `new MediaQuery('(prefers-reduced-motion: reduce)')`
// を作るため、`window.matchMedia` を持たない jsdom で **import しただけで落ちる**
// (bundler は `/*@__PURE__*/` で落とせるが vitest の SSR transform は評価する)。
// この module を import する将来の test すべてに matchMedia polyfill を強いるより、
// 補間 10 行を持つ方が安い。easing だけ `svelte/easing` から借りる。
import { cubicOut } from 'svelte/easing';
import { browser } from '$app/environment';
import type { PointSettings } from '$lib/domain/point-display';
import type { BalanceChangePlan, FlightPoint, FlightRect } from './point-flight-plan';
import { POINT_FLIGHT_COUNT_MS, POINT_FLIGHT_FLY_MS, planBalanceChange } from './point-flight-plan';

export interface PointFlightGhost {
	label: string;
	tone: 'gain' | 'spend';
	from: FlightPoint;
	to: FlightPoint;
}

function prefersReducedMotion(): boolean {
	if (!browser || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function toRect(el: Element | null): FlightRect | null {
	if (!el) return null;
	const r = el.getBoundingClientRect();
	return { left: r.left, top: r.top, width: r.width, height: r.height };
}

class PointFlightController {
	/** ヘッダー残高の実 DOM。baby モード / ?screenshot では登録されない = 演出しない */
	#anchor: HTMLElement | null = null;
	/** 飛行中の ghost。null なら非表示 */
	ghost = $state<PointFlightGhost | null>(null);
	/** hold 中はヘッダーがこの値を表示する。null なら実データをそのまま表示 */
	#holding = $state(false);
	#displayed = $state(0);
	#raf: number | null = null;
	#ghostSettled: (() => void) | null = null;

	/** ヘッダーが表示すべき残高。hold していなければ null */
	get displayBalance(): number | null {
		return this.#holding ? this.#displayed : null;
	}

	/** Header から呼ぶ。戻り値は解除関数 ($effect の cleanup にそのまま返せる) */
	registerAnchor(el: HTMLElement | null): () => void {
		this.#anchor = el;
		return () => {
			if (this.#anchor === el) {
				this.#anchor = null;
				// anchor が消えた状態で hold が残るとヘッダーが古い値で固まる
				this.release();
			}
		};
	}

	get anchorRect(): FlightRect | null {
		return toRect(this.#anchor);
	}

	#cancelRaf(): void {
		if (this.#raf !== null && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(this.#raf);
		}
		this.#raf = null;
	}

	/** 残高表示を指定値で止める (invalidateAll での無言の書き換えを防ぐ) */
	hold(value: number): void {
		this.#cancelRaf();
		this.#displayed = value;
		this.#holding = true;
	}

	/** from → to を POINT_FLIGHT_COUNT_MS かけて数える */
	#countUp(from: number, to: number): Promise<void> {
		if (typeof requestAnimationFrame !== 'function') {
			this.#displayed = to;
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			const started = performance.now();
			const step = (now: number) => {
				const t = Math.min(1, (now - started) / POINT_FLIGHT_COUNT_MS);
				this.#displayed = Math.round(from + (to - from) * cubicOut(t));
				if (t < 1) {
					this.#raf = requestAnimationFrame(step);
				} else {
					this.#raf = null;
					resolve();
				}
			};
			this.#raf = requestAnimationFrame(step);
		});
	}

	release(): void {
		this.#cancelRaf();
		this.#holding = false;
		this.ghost = null;
		this.#ghostSettled?.();
		this.#ghostSettled = null;
	}

	/** ghost 側 (PointFlightGhost.svelte) が飛行完了を知らせる */
	finishGhost(): void {
		this.ghost = null;
		this.#ghostSettled?.();
		this.#ghostSettled = null;
	}

	async #flyGhost(ghost: PointFlightGhost): Promise<void> {
		this.ghost = ghost;
		await new Promise<void>((resolve) => {
			let settled = false;
			const done = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve();
			};
			// ghost 側の animation 完了、または保険のタイムアウトのどちらか早い方で先へ進む
			// (タブ非アクティブ等で WAAPI の finished が来ない場合に hold が残らないようにする)
			const timer = setTimeout(done, POINT_FLIGHT_FLY_MS + 400);
			this.#ghostSettled = done;
		});
	}

	async run(plan: Extract<BalanceChangePlan, { animate: true }>): Promise<void> {
		await this.#flyGhost({ label: plan.label, tone: plan.tone, from: plan.from, to: plan.to });
		this.hold(plan.countFrom);
		await this.#countUp(plan.countFrom, plan.countTo);
	}
}

export const pointFlight = new PointFlightController();

export interface AnimateBalanceChangeOptions {
	/** 変化前の残高 */
	balanceBefore: number;
	/** 出発点 = ポイント数字の矩形。掴めなければ null (残高の少し下から飛ばす) */
	originRect: FlightRect | null;
	settings: PointSettings;
	/** 新しい残高を取り込む処理 (通常 invalidateAll) */
	commit: () => Promise<void> | void;
	/** commit 後の残高を読む */
	readBalance: () => number;
}

/**
 * 残高を更新し、変化ぶんを `+N` / `-N` としてヘッダー残高へ飛ばす。
 *
 * 演出可否によらず `commit()` は必ず実行する (演出は加飾であって、データ更新の条件ではない)。
 */
export async function animateBalanceChange(options: AnimateBalanceChangeOptions): Promise<void> {
	const { balanceBefore, originRect, settings, commit, readBalance } = options;

	// 演出できない環境ならデータ更新だけ行う (hold もしない = ヘッダーは即最終値)
	const canAnimate = browser && !prefersReducedMotion() && pointFlight.anchorRect !== null;
	if (!canAnimate) {
		await commit();
		return;
	}

	pointFlight.hold(balanceBefore);
	try {
		await commit();
		const plan = planBalanceChange({
			balanceBefore,
			balanceAfter: readBalance(),
			originRect,
			anchorRect: pointFlight.anchorRect,
			reducedMotion: prefersReducedMotion(),
			settings,
		});
		if (!plan.animate) return;
		await pointFlight.run(plan);
	} finally {
		pointFlight.release();
	}
}

/** 呼び出し側が要素から矩形を掴むための薄い helper (閉じる前に同期で呼ぶ) */
export function captureFlightOrigin(el: Element | null | undefined): FlightRect | null {
	return toRect(el ?? null);
}
