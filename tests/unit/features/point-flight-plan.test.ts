// tests/unit/features/point-flight-plan.test.ts
// #4448: 「+10p / -10p」がヘッダー残高へ飛び込みカウントアップする演出の判定ロジック。
//
// テスト対象: src/lib/features/point-flight/point-flight-plan.ts
//
// 本 test は「演出する / しない」の両方を固定する。
// - 演出しない側 (AC4 reduced-motion / AC5 screenshot・baby = anchor 未登録 / AC7 再描画で無変化)
// - 演出する側 (AC1 獲得 / AC2 消費 / AC3 単位) も同時に固定し、
//   「出なくなりすぎる」方向の回帰も検出する。

import { describe, expect, it } from 'vitest';
import type { PointSettings } from '$lib/domain/point-display';
import {
	POINT_FLIGHT_FALLBACK_OFFSET_Y,
	planBalanceChange,
} from '$lib/features/point-flight/point-flight-plan';

const POINT_SETTINGS: PointSettings = { mode: 'point', currency: 'JPY', rate: 1 };

/** jsdom の DOMRect は getBoundingClientRect 相当の plain object で十分 */
function rect(x: number, y: number, width = 40, height = 20) {
	return { left: x, top: y, width, height };
}

const ANCHOR = rect(300, 10, 60, 24);
const ORIGIN = rect(100, 400, 80, 30);

function base() {
	return {
		balanceBefore: 100,
		balanceAfter: 110,
		originRect: ORIGIN,
		anchorRect: ANCHOR,
		reducedMotion: false,
		settings: POINT_SETTINGS,
	};
}

describe('planBalanceChange — 演出する側 (AC1 / AC2 / AC3)', () => {
	it('AC1: 獲得は + 符号・gain トーンで、出発点から残高の実座標へ飛ぶ', () => {
		const plan = planBalanceChange(base());

		expect(plan.animate).toBe(true);
		if (!plan.animate) return;
		expect(plan.tone).toBe('gain');
		expect(plan.label.startsWith('+')).toBe(true);
		expect(plan.label).toBe('+10P');
		// 出発点 = 渡された矩形の中心
		expect(plan.from).toEqual({ x: 100 + 80 / 2, y: 400 + 30 / 2 });
		// 到着点 = ヘッダー残高の実座標の中心 (固定座標のベタ書きではない)
		expect(plan.to).toEqual({ x: 300 + 60 / 2, y: 10 + 24 / 2 });
		expect(plan.countFrom).toBe(100);
		expect(plan.countTo).toBe(110);
	});

	it('AC1: 到着点は anchor 矩形に追従する (固定座標ではない)', () => {
		const moved = planBalanceChange({ ...base(), anchorRect: rect(700, 40, 60, 24) });
		expect(moved.animate).toBe(true);
		if (!moved.animate) return;
		expect(moved.to).toEqual({ x: 730, y: 52 });
	});

	it('AC2: 消費は - 符号・spend トーンで、残高は減算後の値まで数える', () => {
		const plan = planBalanceChange({ ...base(), balanceBefore: 100, balanceAfter: 70 });

		expect(plan.animate).toBe(true);
		if (!plan.animate) return;
		expect(plan.tone).toBe('spend');
		expect(plan.label).toBe('-30P');
		expect(plan.countFrom).toBe(100);
		expect(plan.countTo).toBe(70);
	});

	it('AC3: 単位は formatPointValueWithSign 経由 — 円換算モードでも正しい', () => {
		const plan = planBalanceChange({
			...base(),
			settings: { mode: 'currency', currency: 'JPY', rate: 10 },
		});
		expect(plan.animate).toBe(true);
		if (!plan.animate) return;
		expect(plan.label).toBe('+100円');
	});

	it('AC3: 前置記号の通貨 (USD) でも符号が先頭に来る', () => {
		const plan = planBalanceChange({
			...base(),
			balanceAfter: 90,
			settings: { mode: 'currency', currency: 'USD', rate: 0.1 },
		});
		expect(plan.animate).toBe(true);
		if (!plan.animate) return;
		expect(plan.label).toBe('-$1.00');
	});

	it('出発点が取れないときは残高の少し下から飛ばす (演出自体は消さない)', () => {
		const plan = planBalanceChange({ ...base(), originRect: null });
		expect(plan.animate).toBe(true);
		if (!plan.animate) return;
		expect(plan.from).toEqual({ x: 330, y: 22 + POINT_FLIGHT_FALLBACK_OFFSET_Y });
	});
});

describe('planBalanceChange — 演出しない側 (AC4 / AC5 / AC7)', () => {
	it('AC4: prefers-reduced-motion: reduce では演出せず最終値のみ', () => {
		const plan = planBalanceChange({ ...base(), reducedMotion: true });
		expect(plan.animate).toBe(false);
		if (plan.animate) return;
		expect(plan.reason).toBe('reduced-motion');
	});

	it('AC5 / baby: 残高 anchor が登録されていなければ演出しない', () => {
		// ?screenshot=all と baby モードは anchor を登録しないことで演出を止める
		const plan = planBalanceChange({ ...base(), anchorRect: null });
		expect(plan.animate).toBe(false);
		if (plan.animate) return;
		expect(plan.reason).toBe('no-anchor');
	});

	it('AC7: 残高が変わっていない再読込・再描画では演出しない', () => {
		const plan = planBalanceChange({ ...base(), balanceBefore: 100, balanceAfter: 100 });
		expect(plan.animate).toBe(false);
		if (plan.animate) return;
		expect(plan.reason).toBe('no-change');
	});

	it('交換申請 (親承認待ち) のように残高が動かない操作でも演出しない', () => {
		const plan = planBalanceChange({ ...base(), balanceBefore: 250, balanceAfter: 250 });
		expect(plan.animate).toBe(false);
	});
});
