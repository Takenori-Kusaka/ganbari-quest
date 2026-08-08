// src/lib/features/point-flight/point-flight-plan.ts
// #4448: 「いま出た +10p」と「右上の残高」をつなぐ演出の判定 (純関数)。
//
// 演出の実行 (DOM / rAF / Tween) は point-flight.svelte.ts が担い、本 module は
// 「演出するのか / しないのか」「どこからどこへ / 何と表示するのか」だけを決める。
// 判定を DOM から切り離してあるので、演出する側・しない側の両方を unit test で固定できる。
//
// 設計上の制約 (Issue #4448 PO 決定事項):
// - 演出を 1 つ増やすのではなく、既にある 2 つの数字 (結果ダイアログのポイント / ヘッダー残高) をつなぐ
// - ADR-0012: 音 / confetti / 待ち時間を足さない。500〜700ms 程度で終わる。操作をブロックしない
// - 色だけに意味を載せない → 表示は必ず formatPointValueWithSign の符号付き文字列
// - 単位は pt 決め打ちにしない → point / 円換算いずれの設定でも formatPointValue* 経由

import type { PointSettings } from '$lib/domain/point-display';
import { formatPointValueWithSign } from '$lib/domain/point-display';

/** 飛行 (ダイアログの数字 → ヘッダー残高) にかける時間 */
export const POINT_FLIGHT_FLY_MS = 380;
/** 残高のカウントアップにかける時間。飛行と合わせて 660ms (ADR-0012 の 500〜700ms 帯) */
export const POINT_FLIGHT_COUNT_MS = 280;

/**
 * 出発点の矩形が取れないとき (ダイアログが既に閉じている等) に使う、
 * ヘッダー残高からの縦オフセット。残高の少し下から吸い込ませる。
 */
export const POINT_FLIGHT_FALLBACK_OFFSET_Y = 56;

/** getBoundingClientRect() の必要部分だけを受け取る (test で DOMRect を作らずに済む) */
export interface FlightRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface FlightPoint {
	x: number;
	y: number;
}

export interface PlanBalanceChangeInput {
	/** 変化前の残高 */
	balanceBefore: number;
	/** 変化後の残高 */
	balanceAfter: number;
	/** 出発点 = 結果ダイアログ / 交換ダイアログのポイント数字の矩形 */
	originRect: FlightRect | null;
	/** 到着点 = ヘッダー残高の実座標。未登録 (baby / ?screenshot) なら null */
	anchorRect: FlightRect | null;
	/** prefers-reduced-motion: reduce か */
	reducedMotion: boolean;
	/** 表示単位設定 */
	settings: PointSettings;
}

export type BalanceChangePlan =
	| {
			animate: false;
			reason: 'no-anchor' | 'reduced-motion' | 'no-change';
	  }
	| {
			animate: true;
			/** 符号付きの表示文字列 (色だけに意味を載せないため必ず + / - を含む) */
			label: string;
			/** 増加 / 減少。色 (success / danger) の出し分けに使う */
			tone: 'gain' | 'spend';
			from: FlightPoint;
			to: FlightPoint;
			countFrom: number;
			countTo: number;
	  };

function center(r: FlightRect): FlightPoint {
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * 残高変化に対して演出するかを決める。
 *
 * 演出しない条件は 3 つだけで、いずれも「演出が邪魔 / 意味を持たない」場合に限る:
 * - anchor 未登録: baby モード (ADR-0011) と `?screenshot=all` (visual regression baseline) は
 *   ヘッダー残高を anchor として登録しないため、ここで止まる
 * - reduced-motion: OS 設定の尊重
 * - 残高が動いていない: 再読込 / 画面復帰 / ナビゲーション / 親承認待ちの交換申請では再生しない (AC7)
 */
export function planBalanceChange(input: PlanBalanceChangeInput): BalanceChangePlan {
	const { balanceBefore, balanceAfter, originRect, anchorRect, reducedMotion, settings } = input;

	if (!anchorRect) return { animate: false, reason: 'no-anchor' };
	if (reducedMotion) return { animate: false, reason: 'reduced-motion' };

	const delta = balanceAfter - balanceBefore;
	if (delta === 0) return { animate: false, reason: 'no-change' };

	const to = center(anchorRect);
	const from = originRect
		? center(originRect)
		: { x: to.x, y: to.y + POINT_FLIGHT_FALLBACK_OFFSET_Y };

	return {
		animate: true,
		label: formatPointValueWithSign(delta, settings.mode, settings.currency, settings.rate),
		tone: delta > 0 ? 'gain' : 'spend',
		from,
		to,
		countFrom: balanceBefore,
		countTo: balanceAfter,
	};
}
