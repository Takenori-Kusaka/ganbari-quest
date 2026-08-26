// tests/unit/components/confirm-exchange-dialog-point-display.test.ts
// #4509 ②: 交換確認ダイアログ (確定の直前に見せる数字) もポイント表示設定を通す。
//
// 一覧とヘッダーだけ換算しても、確定前の最後の画面が生ポイントのままなら
// 子供は「いくら払うのか」を最後まで誤認したまま確定してしまう。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PointSettings } from '../../../src/lib/domain/point-display';

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

afterEach(() => cleanup());

const POINT_MODE: PointSettings = { mode: 'point', currency: 'JPY', rate: 1 };
const YEN_MODE: PointSettings = { mode: 'currency', currency: 'JPY', rate: 0.5 };

let ConfirmExchangeDialog: unknown;
beforeAll(async () => {
	ConfirmExchangeDialog = (
		await import('../../../src/routes/(child)/[uiMode=uiMode]/shop/ConfirmExchangeDialog.svelte')
	).default;
}, 60_000);

function renderDialog(pointSettings: PointSettings) {
	render(ConfirmExchangeDialog as never, {
		props: {
			open: true,
			rewardId: 'r-1',
			rewardTitle: 'アイス',
			rewardPoints: 100,
			rewardIcon: '🍦',
			balance: 600,
			pointSettings,
			autoApprove: false,
			onClose: () => {},
		} as never,
	});
}

describe('#4509 ② 交換確認ダイアログのポイント表示', () => {
	it('通貨モードでは消費ぶんが換算後の値になる', async () => {
		renderDialog(YEN_MODE);
		expect((await screen.findByTestId('confirm-total-points')).textContent).toBe('50円');
	});

	it('通貨モードでは交換後の残りも換算後の値になる', async () => {
		renderDialog(YEN_MODE);
		// 残高 600pt - 100pt = 500pt = 250 円
		const el = await screen.findByTestId('confirm-remaining-after');
		expect(el.textContent).toContain('250円');
		expect(el.textContent).not.toContain('ポイント');
	});

	// #4556: 単位の連結は formatPointDisplayText に集約し、区切りは半角スペースに揃えた。
	// このダイアログ自身が既にスペースあり側で描画しているため (主数値は
	// `.confirm-points-value { display: flex; gap: 4px }` で数値と単位を分離、
	// `exchangeConfirmTitle` は `（100 ポイント）`)、スペース無しだったのは
	// 「のこり」の 1 行だけで、同じダイアログ内で表記が割れていた。
	it('ポイントモードの表示は数値 + 半角スペース + 「ポイント」', async () => {
		renderDialog(POINT_MODE);
		expect((await screen.findByTestId('confirm-total-points')).textContent).toBe('100');
		expect((await screen.findByTestId('confirm-remaining-after')).textContent).toContain(
			'500 ポイント',
		);
	});
});
