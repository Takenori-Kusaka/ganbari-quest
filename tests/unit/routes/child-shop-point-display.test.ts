// tests/unit/routes/child-shop-point-display.test.ts
// #4509 ②: ショップ画面のポイント表示が「ポイント表示設定」を必ず通ることを固定する。
//
// ## 旧実装の何が壊れていたか
//
// 同じ画面のヘッダー (Header.svelte) は formatPointValue で円換算していたのに、
// ショップ本体は `{reward.points}` + 固定「ポイント」を描画していた。通貨モードの家庭では
// ヘッダーに「500円」、その真下のごほうびに「1000 ポイント」が並び、子供には
// **買えるのか買えないのかが読めない矛盾した数字**が見えていた。
//
// 残高 / ごほうび価格 / 不足分ヒント のすべてが換算後の値になることを固定する。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PointSettings } from '../../../src/lib/domain/point-display';

// Ark UI (Tabs) が要求する観測 API。jsdom には無いので最小 stub を置く。
class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

vi.mock('$app/state', () => ({
	get page() {
		return { params: { uiMode: 'elementary' }, url: new URL('http://localhost/elementary/shop') };
	},
}));

afterEach(() => cleanup());

const POINT_MODE: PointSettings = { mode: 'point', currency: 'JPY', rate: 1 };
const YEN_MODE: PointSettings = { mode: 'currency', currency: 'JPY', rate: 0.5 };

const REWARD = {
	id: 'r-1',
	title: 'アイス',
	points: 1000,
	icon: '🍦',
	shopCategory: 'physical',
	latestRequestStatus: null,
};

// SvelteKit page component の初回 import は transform に数秒かかるため、
// 各 test の 5s timeout を食い潰さないよう先に済ませておく。
let ShopPage: unknown;
beforeAll(async () => {
	ShopPage = (await import('../../../src/routes/(child)/[uiMode=uiMode]/shop/+page.svelte'))
		.default;
}, 60_000);

function renderShop(pointSettings: PointSettings, balance: number) {
	render(ShopPage as never, {
		props: {
			data: { rewards: [REWARD], balance, pointSettings },
			form: null,
		} as never,
	});
}

describe('#4509 ② ショップのポイント表示 — 通貨モード', () => {
	it('残高が rate 換算後の値になる (生ポイントを出さない)', () => {
		renderShop(YEN_MODE, 600);
		const balance = screen.getByTestId('point-balance');
		expect(balance.textContent).toContain('300円');
		expect(balance.textContent).not.toContain('600');
	});

	it('残高に「円」と「ポイント」が二重に並ばない', () => {
		renderShop(YEN_MODE, 600);
		expect(screen.getByTestId('point-balance').textContent).not.toContain('ポイント');
	});

	it('ごほうびの価格が rate 換算後の値になる', () => {
		renderShop(YEN_MODE, 600);
		const card = screen.getByTestId('reward-card-r-1');
		expect(card.textContent).toContain('500円');
		expect(card.textContent).not.toContain('1000');
		expect(card.textContent).not.toContain('1,000');
	});

	it('不足分ヒントも換算後の値で伝える', () => {
		renderShop(YEN_MODE, 600);
		// 不足 400 ポイント = 200 円。生ポイントのままだと「あと 400 ポイント」と嘘になる
		const card = screen.getByTestId('reward-card-r-1');
		expect(card.textContent).toContain('200円');
		expect(card.textContent).not.toContain('400');
	});
});

describe('#4509 ② ショップのポイント表示 — ポイントモード (既存表示の維持)', () => {
	it('残高は生ポイント + 子供向けの「ポイント」語のまま', () => {
		renderShop(POINT_MODE, 600);
		const balance = screen.getByTestId('point-balance');
		expect(balance.textContent).toContain('600');
		expect(balance.textContent).toContain('ポイント');
	});

	it('ごほうび価格と不足分ヒントも従来どおり', () => {
		renderShop(POINT_MODE, 600);
		const card = screen.getByTestId('reward-card-r-1');
		expect(card.textContent).toContain('1,000');
		expect(card.textContent).toContain('400');
	});
});
