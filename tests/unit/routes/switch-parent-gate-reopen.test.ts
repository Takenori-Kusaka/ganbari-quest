// tests/unit/routes/switch-parent-gate-reopen.test.ts
// #4050: 「おやカギコード modal を閉じると親管理画面に二度と到達できない」dead-end の回帰テスト。
//
// 旧実装の欠陥 (2 段構造):
//   1. `handleAdminLinkClick` が `data.adminLink !== '/admin'` で早期 return していた。
//      cognito 本番モードでは adminLink='/auth/login' 固定のため、ログイン済ユーザが link を
//      押しても client 側 modal が開かず、/auth/login → /admin → /switch?pinRequired=1 の
//      同一 URL 往復に落ちる。
//   2. 往復先が同一 URL のため SvelteKit は component を再マウントせず、`prevPinRequired`
//      ガード (#2992) と `data.pinRequired` が共に true のまま → modal 自動 open の $effect が
//      no-op → modal が二度と開かない。
//
// 本 test は component 層で (1) を潰したこと (= link click で必ず modal が再 open すること) と、
// 初回作成 modal がバイパス不能 (× ボタン非表示) であることを assert する。
// e2e (tests/e2e/parent-gate.spec.ts) は実 redirect 往復を含む統合経路を担保する二重防御。

import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy: () => {} }),
}));
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(async () => {}),
}));
// jsdom に AudioContext が無いため sound service を no-op stub にする
vi.mock('$lib/ui/sound/sound-service', () => ({
	soundService: { ensureContext: () => {}, play: () => {} },
}));

import type { Component } from 'svelte';
import { UI_PRIMITIVES_LABELS } from '../../../src/lib/domain/labels';
import SwitchPageRaw from '../../../src/routes/switch/+page.svelte';

// jsdom は `CSS` global を実装しておらず、zag-js の pin-input が `CSS.escape` を参照した
// 時点で TypeError になる (modal 内の PinInput が mount された瞬間に発生)。
// 実ブラウザ / Playwright では存在するため、test 環境のみ最小 polyfill を当てる。
if (typeof globalThis.CSS === 'undefined') {
	(globalThis as { CSS?: unknown }).CSS = {
		escape: (value: string) => value.replace(/([^\w-])/g, '\\$1'),
	};
}

/** Ark UI Dialog は閉じても DOM に残る場合があるため data-state で可視判定する */
function isOpen(el: HTMLElement | null): boolean {
	return el !== null && el.getAttribute('data-state') === 'open';
}

type SwitchProps = {
	children: Array<{ id: number; nickname: string; age: number; theme: string; avatarUrl: null }>;
	adminLink: string;
	parentGateInteractive: boolean;
	showAdminLink: boolean;
	reason: string | null;
	timedOut: boolean;
	pinRequired: boolean;
	nextPath: string;
	onboarding: null;
	pinConfigured: boolean;
	pinResetAvailable: boolean;
};

const SwitchPage = SwitchPageRaw as unknown as Component<{ data: SwitchProps }>;

function makeData(overrides: Partial<SwitchProps> = {}): SwitchProps {
	return {
		children: [],
		// cognito ログイン済 (#4050 修正後の既定)
		adminLink: '/admin',
		parentGateInteractive: true,
		showAdminLink: true,
		reason: null,
		timedOut: false,
		pinRequired: true,
		nextPath: '/admin',
		onboarding: null,
		pinConfigured: true,
		pinResetAvailable: true,
		...overrides,
	};
}

afterEach(() => cleanup());

describe('#4050 /switch 親ゲート modal の再オープン保証', () => {
	it('AC5: 解錠 modal を閉じた後に「ご家族の見守り画面」を押すと modal が再オープンする', async () => {
		const { getByTestId, queryByTestId, getByLabelText } = render(SwitchPage, {
			props: { data: makeData() },
		});

		// pinRequired=1 到達で modal が自動 open
		await waitFor(() => expect(isOpen(queryByTestId('parent-gate-modal'))).toBe(true));

		// × で閉じる (解錠 modal は closable = 閉じられる)
		await fireEvent.click(getByLabelText(UI_PRIMITIVES_LABELS.closeAriaLabel));
		await waitFor(() => expect(isOpen(queryByTestId('parent-gate-modal'))).toBe(false));

		// 再度リンクを押すと modal が開く (旧実装ではここが no-op で dead-end だった)
		await fireEvent.click(getByTestId('switch-admin-link'));
		await waitFor(() => expect(isOpen(queryByTestId('parent-gate-modal'))).toBe(true));
	});

	it('AC5: link click は既定遷移を抑止して client 側 modal で処理する', async () => {
		const { getByTestId } = render(SwitchPage, { props: { data: makeData() } });
		const link = getByTestId('switch-admin-link');

		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		await fireEvent(link, event);

		expect(event.defaultPrevented).toBe(true);
	});

	it('未ログイン (parentGateInteractive=false) では素の /auth/login 遷移に委ねる', async () => {
		const { getByTestId, queryByTestId } = render(SwitchPage, {
			props: {
				data: makeData({
					adminLink: '/auth/login',
					parentGateInteractive: false,
					pinRequired: false,
				}),
			},
		});
		const link = getByTestId('switch-admin-link');
		expect(link.getAttribute('href')).toBe('/auth/login');

		const event = new MouseEvent('click', { bubbles: true, cancelable: true });
		await fireEvent(link, event);

		// preventDefault せず、modal も開かない (ログイン画面へ遷移させる)
		expect(event.defaultPrevented).toBe(false);
		expect(isOpen(queryByTestId('parent-gate-modal'))).toBe(false);
	});

	it('AC1: 初回作成 modal (pinConfigured=false) には × クローズボタンが無い', async () => {
		const { getByTestId, queryByLabelText } = render(SwitchPage, {
			props: { data: makeData({ pinConfigured: false }) },
		});

		await waitFor(() => expect(getByTestId('parent-gate-create')).toBeTruthy());
		expect(queryByLabelText(UI_PRIMITIVES_LABELS.closeAriaLabel)).toBeNull();
	});

	it('AC1 対比: 解錠 modal (pinConfigured=true) には × クローズボタンがある', async () => {
		const { getByTestId, getByLabelText } = render(SwitchPage, {
			props: { data: makeData() },
		});

		await waitFor(() => expect(getByTestId('parent-gate-modal')).toBeTruthy());
		expect(getByLabelText(UI_PRIMITIVES_LABELS.closeAriaLabel)).toBeTruthy();
	});
});
