// tests/unit/features/push-status.test.ts
// #3186: getPushStatus() がユーザ向け 4 状態 (unsupported/blocked/off/on) に
// 内部の permission↔subscription 差を正しく隠蔽してマッピングするか検証する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPushStatus } from '../../../src/lib/features/admin/push-subscription';

const g = globalThis as unknown as {
	window?: unknown;
	navigator?: unknown;
	Notification?: unknown;
	PushManager?: unknown;
};

const orig = {
	window: g.window,
	navigator: g.navigator,
	Notification: g.Notification,
	PushManager: g.PushManager,
};

/** isPushSupported() = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window */
function setupSupported(opts: { permission: NotificationPermission; subscription: unknown }) {
	const navigatorStub = {
		serviceWorker: {
			getRegistration: async () => ({
				pushManager: { getSubscription: async () => opts.subscription },
			}),
		},
	};
	g.window = { PushManager: function PushManager() {}, Notification: {} };
	g.navigator = navigatorStub;
	g.PushManager = (g.window as { PushManager: unknown }).PushManager;
	g.Notification = { permission: opts.permission };
}

describe('#3186 getPushStatus() — 内部状態を 4 値に隠蔽', () => {
	beforeEach(() => {
		vi.stubGlobal('window', undefined);
	});
	afterEach(() => {
		g.window = orig.window;
		g.navigator = orig.navigator;
		g.Notification = orig.Notification;
		g.PushManager = orig.PushManager;
		vi.unstubAllGlobals();
	});

	it('Web Push 非対応 (serviceWorker 無し) → unsupported', async () => {
		g.window = { PushManager: () => {}, Notification: {} };
		g.navigator = {}; // serviceWorker 無し
		g.Notification = { permission: 'default' };
		expect(await getPushStatus()).toBe('unsupported');
	});

	it('permission=denied → blocked', async () => {
		setupSupported({ permission: 'denied', subscription: null });
		expect(await getPushStatus()).toBe('blocked');
	});

	it('permission=default かつ subscription 無し → off (未登録を内部状態として出さない)', async () => {
		setupSupported({ permission: 'default', subscription: null });
		expect(await getPushStatus()).toBe('off');
	});

	it('permission=granted だが subscription 無し → off (旧「許可済み（未登録）」を off に統合)', async () => {
		setupSupported({ permission: 'granted', subscription: null });
		expect(await getPushStatus()).toBe('off');
	});

	it('subscription あり → on', async () => {
		setupSupported({ permission: 'granted', subscription: { endpoint: 'https://x' } });
		expect(await getPushStatus()).toBe('on');
	});

	it('SW 未登録 (getRegistration が undefined) → off で固まらない (#3186 hang 回避)', async () => {
		g.window = { PushManager: () => {}, Notification: {} };
		g.navigator = { serviceWorker: { getRegistration: async () => undefined } };
		g.PushManager = (g.window as { PushManager: unknown }).PushManager;
		g.Notification = { permission: 'granted' };
		expect(await getPushStatus()).toBe('off');
	});
});
