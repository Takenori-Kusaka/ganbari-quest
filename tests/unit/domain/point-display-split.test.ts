// tests/unit/domain/point-display-split.test.ts
// #4509 ②: 「数値」と「単位」を別要素で組む子供画面 (ショップの残高 / ごほうび価格 /
// 交換確認ダイアログ) が、ポイント表示設定 (point / currency + rate 換算) を必ず通ることを固定する。
//
// 旧実装は生ポイント + 固定「ポイント」を出しており、通貨モードの家庭では
// **同じ画面のヘッダー (円換算)** と矛盾した数字が並んでいた。

import { describe, expect, it } from 'vitest';
import type { PointSettings } from '../../../src/lib/domain/point-display';
import { formatPointValue, splitPointDisplay } from '../../../src/lib/domain/point-display';

const POINT_MODE: PointSettings = { mode: 'point', currency: 'JPY', rate: 1 };
const YEN_MODE: PointSettings = { mode: 'currency', currency: 'JPY', rate: 0.5 };
const USD_MODE: PointSettings = { mode: 'currency', currency: 'USD', rate: 0.01 };
const WORD = 'ポイント';

describe('#4509 ② splitPointDisplay', () => {
	it('ポイントモードは子供向けの語をそのまま単位に使う (既存表示を変えない)', () => {
		expect(splitPointDisplay(50, POINT_MODE, WORD)).toEqual({ amount: '50', unit: WORD });
	});

	it('ポイントモードでも桁区切りは入る', () => {
		expect(splitPointDisplay(1250, POINT_MODE, WORD).amount).toBe('1,250');
	});

	it('通貨モードは rate 換算した値を出す — 生ポイントを出さない', () => {
		const parts = splitPointDisplay(100, YEN_MODE, WORD);
		expect(parts.amount).toBe('50円');
		expect(parts.amount).not.toContain('100');
	});

	it('通貨モードでは「ポイント」単位を併記しない (円 と ポイント の二重単位を防ぐ)', () => {
		expect(splitPointDisplay(100, YEN_MODE, WORD).unit).toBe('');
		expect(splitPointDisplay(100, USD_MODE, WORD).unit).toBe('');
	});

	it('記号が前置される通貨でも表示が壊れない', () => {
		expect(splitPointDisplay(500, USD_MODE, WORD).amount).toBe('$5.00');
	});

	it('連結すると formatPointValue と同じ数値表現になる (同一画面内で単位が矛盾しない)', () => {
		for (const settings of [POINT_MODE, YEN_MODE, USD_MODE]) {
			const parts = splitPointDisplay(320, settings, WORD);
			const canonical = formatPointValue(320, settings.mode, settings.currency, settings.rate);
			if (settings.mode === 'currency') {
				expect(parts.amount).toBe(canonical);
			} else {
				// ポイントモードだけは子供向けの語 (「ポイント」) を使うため単位表記が異なるが、
				// 数値部分は canonical (`1,250P`) と一致していなければならない。
				expect(canonical.startsWith(parts.amount)).toBe(true);
			}
		}
	});
});
