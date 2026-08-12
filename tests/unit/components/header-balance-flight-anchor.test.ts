// tests/unit/components/header-balance-flight-anchor.test.ts
// #4448: ヘッダー残高が「増減演出の到着点」として登録される条件を固定する。
//
// なぜ必要か: 演出を止める唯一の gate が「anchor を登録しない」ことなので、
// ここが緩むと baby モード (ADR-0011) と `?screenshot=all` (visual regression baseline、AC5)
// で演出が走ってしまう。逆に登録されなくなれば AC1 が成立しない。両方向を固定する。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { pointFlight } from '../../../src/lib/features/point-flight/point-flight.svelte';
import Header from '../../../src/lib/ui/components/Header.svelte';

const BASE = { nickname: 'たろう', totalPoints: 120 } as const;

describe('Header — 残高 anchor の登録条件 (#4448)', () => {
	afterEach(() => {
		cleanup();
		pointFlight.release();
	});

	it('animateBalance=true なら残高要素が到着点として登録される', () => {
		render(Header, { ...BASE, animateBalance: true });
		expect(screen.getByTestId('header-balance').textContent).toBe('120P');
		expect(pointFlight.anchorRect, '到着点が登録されていること').not.toBeNull();
	});

	it('animateBalance=false (baby / ?screenshot) なら登録されない = 演出が始まらない', () => {
		render(Header, { ...BASE, animateBalance: false });
		expect(screen.getByTestId('header-balance').textContent).toBe('120P');
		expect(pointFlight.anchorRect, '到着点を登録しないことで演出を止める').toBeNull();
	});

	it('既定 (prop 未指定) は登録しない — 演出は opt-in', () => {
		render(Header, { ...BASE });
		expect(pointFlight.anchorRect).toBeNull();
	});

	it('演出中は数えている途中の値を表示し、終わったら実データに戻る', async () => {
		render(Header, { ...BASE, animateBalance: true });
		const el = screen.getByTestId('header-balance');

		pointFlight.hold(100);
		await Promise.resolve();
		expect(el.textContent, '変化前の値で止めてから数え上げる').toBe('100P');

		pointFlight.release();
		await Promise.resolve();
		expect(el.textContent, '演出後は実データをそのまま表示する').toBe('120P');
	});

	it('animateBalance=false のときは hold されていても実データを表示する', async () => {
		render(Header, { ...BASE, animateBalance: false });
		const el = screen.getByTestId('header-balance');

		pointFlight.hold(100);
		await Promise.resolve();
		expect(el.textContent, '演出対象外の画面は常に最終値').toBe('120P');
	});

	it('円換算モードでも残高表示は formatPointValue 経由 (単位を pt 決め打ちにしない)', () => {
		render(Header, {
			...BASE,
			animateBalance: true,
			pointSettings: { mode: 'currency', currency: 'JPY', rate: 10 },
		});
		expect(screen.getByTestId('header-balance').textContent).toBe('1,200円');
	});
});
