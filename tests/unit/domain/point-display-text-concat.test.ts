// tests/unit/domain/point-display-text-concat.test.ts
//
// #4556 ② — ポイント表示の「数値 + 単位」の連結を 1 箇所に固定する。
//
// `splitPointDisplay` は amount / unit を分けて返すため、**連結の仕方が呼び出し側の自由**
// だった。結果、同じショップの CUJ 内で一覧 (`${amount} ${unit}`) と交換確認ダイアログ
// (`${amount}${unit}`) に割れ、ポイントモードの家庭では「あと 250 ポイント」→
// 「のこり: 250ポイント」と表記が揺れていた。子供の目に連続して入る画面なので固定する。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPointDisplayText, type PointSettings } from '../../../src/lib/domain/point-display';

const WORD = 'ポイント';
const POINT_MODE: PointSettings = { mode: 'point', currency: 'JPY', rate: 1 };
const YEN_MODE: PointSettings = { mode: 'currency', currency: 'JPY', rate: 1 };
const USD_MODE: PointSettings = { mode: 'currency', currency: 'USD', rate: 0.01 };

describe('#4556 ② formatPointDisplayText', () => {
	it('ポイントモードは数値と単位を半角スペースで区切る', () => {
		expect(formatPointDisplayText(250, POINT_MODE, WORD)).toBe('250 ポイント');
	});

	it('3 桁区切りは splitPointDisplay と同じ', () => {
		expect(formatPointDisplayText(1250, POINT_MODE, WORD)).toBe('1,250 ポイント');
	});

	it('通貨モードは単位が空なので余分なスペースが付かない', () => {
		// 記号は amount 側に含まれる (後置 = 円 / 前置 = $)。二重単位もスペース浮きも起こさない。
		expect(formatPointDisplayText(250, YEN_MODE, WORD)).toBe('250円');
		expect(formatPointDisplayText(500, USD_MODE, WORD)).toBe('$5.00');
	});
});

describe('#4556 ② ショップ 2 画面が同じ整形関数を通る', () => {
	// 一覧の不足分ヒントと確認ダイアログの残高は同一 CUJ 内で連続して読まれる。
	// どちらかを自前の連結に戻すと落ちる。
	const SHOP_FILES = [
		'src/routes/(child)/[uiMode=uiMode]/shop/+page.svelte',
		'src/routes/(child)/[uiMode=uiMode]/shop/ConfirmExchangeDialog.svelte',
	];

	const read = (rel: string) => readFileSync(resolve(__dirname, '../../..', rel), 'utf-8');

	it.each(SHOP_FILES)('%s が formatPointDisplayText を使っている', (rel) => {
		expect(read(rel)).toContain('formatPointDisplayText(');
	});

	it.each(SHOP_FILES)('%s が amount と unit を自前で連結していない', (rel) => {
		// `${amount} ${unit}` / `${amount}${unit}` のような自前連結 = 連結ルールの複製。
		const inlineConcat = [...read(rel).matchAll(/`[^`]*\$\{[^`]*`/g)].filter(
			(m) => m[0].includes('amount') && m[0].includes('unit'),
		);
		expect(
			inlineConcat.map((m) => m[0]),
			'amount / unit を template literal で自前連結しています。' +
				'$lib/domain/point-display の formatPointDisplayText を使ってください (#4556)',
		).toEqual([]);
	});
});
