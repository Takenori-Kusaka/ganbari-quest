// tests/unit/components/notification-permission-banner.test.ts
// #2115 (Bug fix: loading / try-catch / Toast / fallback)
// #2116 (透明性 UX: 2 段階開示 informed consent)
//
// 本 spec のスコープ:
//   - #2115 AC8: handleSubscribe の try/catch / state 更新 / fallback 動作
//   - #2116 AC3: 2 段階 disclosure の disclosure 要素描画
//   - #2116 AC4: disclosure 内に通知種別 3 系統 + 親端末限定 + quiet hours が含まれる
//
// E2E (`tests/e2e/notification-permission-banner.spec.ts`) は実ブラウザで
// 通知ダイアログ周辺の visible/click smoke を担当。本 unit test は
// permission state や fetch エラーを mock 可能な範囲で網羅する。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// push-subscription module 全体を mock (jsdom には PushManager / serviceWorker がない)
vi.mock('$lib/features/admin/push-subscription', () => ({
	isPushSupported: vi.fn(() => true),
	getNotificationPermission: vi.fn(() => 'default'),
	subscribeToPush: vi.fn(),
}));

// Toast は副作用のみ確認できれば十分なので spy 化
vi.mock('$lib/ui/primitives/Toast.svelte', async () => {
	const actual = await vi.importActual<Record<string, unknown>>('$lib/ui/primitives/Toast.svelte');
	return {
		...actual,
		showToast: vi.fn(),
	};
});

import * as pushModule from '$lib/features/admin/push-subscription';
import * as toastModule from '$lib/ui/primitives/Toast.svelte';
import NotificationPermissionBanner from '../../../src/lib/features/admin/components/NotificationPermissionBanner.svelte';

const mockedSubscribeToPush = pushModule.subscribeToPush as ReturnType<typeof vi.fn>;
const mockedGetPermission = pushModule.getNotificationPermission as ReturnType<typeof vi.fn>;
const mockedShowToast = toastModule.showToast as ReturnType<typeof vi.fn>;

describe('NotificationPermissionBanner (#2115 / #2116)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedGetPermission.mockReturnValue('default');
	});

	afterEach(() => {
		cleanup();
	});

	describe('#2116 透明性 UX (descCompact + 2 段階開示)', () => {
		it('descCompact (頻度 / 内容 / 親端末 / quiet hours) を表示する', () => {
			render(NotificationPermissionBanner);
			const desc = screen.getByTestId('notification-banner-desc-compact');
			// 必須 4 要素が含まれる
			expect(desc.textContent).toContain('毎日 1 回まで'); // 頻度
			expect(desc.textContent).toContain('がんばりリマインダー'); // 内容
			expect(desc.textContent).toContain('親端末'); // 送信先
			expect(desc.textContent).toContain('21:00-07:00'); // quiet hours
		});

		it('disclosure (<details>) を描画する', () => {
			render(NotificationPermissionBanner);
			expect(screen.getByTestId('notification-banner-disclosure')).toBeDefined();
		});

		it('disclosure 内に 3 系統 + 親端末限定 + quiet hours + 設定リンクを含む', () => {
			render(NotificationPermissionBanner);
			const disclosure = screen.getByTestId('notification-banner-disclosure');
			expect(disclosure.textContent).toContain('がんばりリマインダー');
			expect(disclosure.textContent).toContain('連続記録');
			expect(disclosure.textContent).toContain('達成のお祝い');
			expect(disclosure.textContent).toContain('親端末');
			expect(disclosure.textContent).toContain('21:00');
			expect(disclosure.textContent).toContain('OFF');
		});

		it('reminder 例文に reminder/+server.ts の文言 (きょうも がんばろう) が含まれる', () => {
			// #2116 AC5: 例文 SSOT 整合 (reminder/+server.ts と一致)
			render(NotificationPermissionBanner);
			const disclosure = screen.getByTestId('notification-banner-disclosure');
			expect(disclosure.textContent).toContain('きょうも がんばろう');
		});
	});

	describe('#2115 Bug fix (loading / try-catch / Toast / fallback)', () => {
		it('成功時: Toast 表示 + バナー消滅 + permission 再評価', async () => {
			// 初期 permission='default' で banner 描画される (mockedGetPermission は beforeEach で default)
			mockedSubscribeToPush.mockResolvedValueOnce({
				endpoint: 'https://push.example.com/x',
				toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
			} as unknown as PushSubscription);

			render(NotificationPermissionBanner);
			const cta = screen.getByTestId('notification-banner-cta');

			// click 後の permission 再評価で 'granted' が返るよう mock を切替 (subscribe 完了直後)
			mockedGetPermission.mockReturnValue('granted');
			await fireEvent.click(cta);

			await waitFor(() => {
				// Toast 呼び出し
				expect(mockedShowToast).toHaveBeenCalledWith(
					expect.stringContaining('通知を有効化'),
					expect.any(String),
					'success',
				);
			});

			// バナー消滅 (visible=false)
			await waitFor(() => {
				expect(screen.queryByTestId('notification-permission-banner')).toBeNull();
			});

			// permission 再評価が呼ばれている ($effect 初期 + subscribe 後の計 2 回以上)
			expect(mockedGetPermission).toHaveBeenCalled();
		});

		it('失敗 (subscribeToPush が null): 拒否 fallback UI を表示', async () => {
			// 初期は default で banner 描画、subscribe 完了時 permission='denied'
			mockedSubscribeToPush.mockImplementationOnce(async () => {
				// subscribe 関数内で許可ダイアログが拒否されると denied になる挙動を simulate
				mockedGetPermission.mockReturnValue('denied');
				return null;
			});

			render(NotificationPermissionBanner);
			const cta = screen.getByTestId('notification-banner-cta');
			await fireEvent.click(cta);

			await waitFor(() => {
				const errorBox = screen.getByTestId('notification-banner-error');
				expect(errorBox).toBeDefined();
				expect(errorBox.textContent).toContain('ブラウザの設定');
			});

			// 設定画面誘導リンクが描画される
			expect(screen.getByTestId('notification-banner-settings-link')).toBeDefined();
		});

		it('例外 throw 時: catch して generic fallback UI を表示 (silent 失敗しない)', async () => {
			mockedSubscribeToPush.mockRejectedValueOnce(new Error('network error'));
			// permission は default のまま (denied じゃないので generic 出る)
			mockedGetPermission.mockReturnValue('default');

			// console.error は test ノイズ抑止
			const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

			render(NotificationPermissionBanner);
			await fireEvent.click(screen.getByTestId('notification-banner-cta'));

			await waitFor(() => {
				const errorBox = screen.getByTestId('notification-banner-error');
				expect(errorBox).toBeDefined();
				expect(errorBox.textContent).toContain('エラー');
			});

			expect(consoleErrSpy).toHaveBeenCalled();
			consoleErrSpy.mockRestore();
		});

		it('loading 中はボタンが disable + ラベル切替', async () => {
			// 解決を遅延させる Promise (mock 初期は default で banner 描画される)
			let resolveSub: (v: PushSubscription | null) => void = () => undefined;
			const pending = new Promise<PushSubscription | null>((resolve) => {
				resolveSub = resolve;
			});
			mockedSubscribeToPush.mockReturnValueOnce(pending);

			render(NotificationPermissionBanner);
			const cta = screen.getByTestId('notification-banner-cta');
			const dismiss = screen.getByTestId('notification-banner-dismiss');

			// click 後の subscribe 完了時 permission='granted' に切替 (resolve 後の再評価用)
			mockedGetPermission.mockReturnValue('granted');
			await fireEvent.click(cta);

			// loading 中: 両ボタン disabled + aria-busy
			await waitFor(() => {
				expect((cta as HTMLButtonElement).disabled).toBe(true);
				expect(cta.getAttribute('aria-busy')).toBe('true');
				expect(cta.textContent).toContain('設定中');
				expect((dismiss as HTMLButtonElement).disabled).toBe(true);
			});

			// 解決後 disable 解除 (visible=false で消えるので queryByTestId で確認)
			resolveSub({
				endpoint: 'https://x',
				toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
			} as unknown as PushSubscription);
			mockedGetPermission.mockReturnValue('granted');

			await waitFor(() => {
				expect(screen.queryByTestId('notification-permission-banner')).toBeNull();
			});
		});

		it('二重クリック中は subscribeToPush を 1 回しか呼ばない (loading guard)', async () => {
			// HTML button[disabled] は click イベント自体を抑止するため、handleSubscribe 内の
			// `if (loading) return;` guard を直接検証するには JS 経由の関数呼出 simulation が必要。
			// ここでは間接的に「2 回連続 click で実 mock 呼出が 1 件のみ」となることを確認。
			// (button[disabled] でクリックイベントが届かないことを以て guard 成立とみなす)
			let resolveSub: (v: PushSubscription | null) => void = () => undefined;
			const pending = new Promise<PushSubscription | null>((resolve) => {
				resolveSub = resolve;
			});
			mockedSubscribeToPush.mockReturnValueOnce(pending);

			render(NotificationPermissionBanner);
			const cta = screen.getByTestId('notification-banner-cta');
			// 連続クリック (1 回目で disabled=true になる)
			await fireEvent.click(cta);
			await fireEvent.click(cta);
			await fireEvent.click(cta);

			// disabled で 2/3 回目はイベント抑止 → mock 呼出は 1 件のみ
			expect(mockedSubscribeToPush).toHaveBeenCalledTimes(1);

			// cleanup のため解決
			mockedGetPermission.mockReturnValue('granted');
			resolveSub({
				endpoint: 'https://x',
				toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
			} as unknown as PushSubscription);
		});
	});
});
