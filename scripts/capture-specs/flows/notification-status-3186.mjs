/**
 * scripts/capture-specs/flows/notification-status-3186.mjs
 *
 * #3186: 通知設定のステータス UI 改訂 SS。旧「許可済み（未登録）」内部状態ジャーゴンを撤廃し、
 * ユーザ向けは ON / OFF + 異常系（ブロック / 非対応）に集約。通知できないときはボタンを
 * disabled にし理由を 1 行で示す。
 *
 * 各状態は実ブラウザの Web Push API 状態に依存するため、capture 専用に `addInitScript` で
 * `Notification.permission` と `navigator.serviceWorker.getRegistration` を stub し、
 * off / on / blocked の 3 状態を決定的に撮影する（本番コードは一切変更しない）。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow notification-status-3186 \
 *     --url "/admin/settings/notifications?plan=family&screenshot=all" \
 *     --actions scripts/capture-specs/flows/notification-status-3186.mjs \
 *     --presets desktop,mobile --pr 3186
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PATH = '/admin/settings/notifications?plan=family&screenshot=all';

/** capture 専用 stub: permission と subscription 有無を上書きする (本番挙動は不変) */
function stubScript(permission, hasSubscription) {
	return `(() => {
		try { Object.defineProperty(Notification, 'permission', { configurable: true, get: () => '${permission}' }); } catch (_) {}
		if (navigator.serviceWorker) {
			navigator.serviceWorker.getRegistration = async () => (${hasSubscription}
				? { pushManager: { getSubscription: async () => ({ endpoint: 'https://example.test/sub' }) } }
				: undefined);
		}
	})();`;
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) OFF（permission=granted / 未購読 → 「通知をオンにする」ボタン）---
	await page.addInitScript(stubScript('granted', false));
	await page.goto(`${BASE_URL}${PATH}`);
	await page.getByTestId('notification-enable-btn').waitFor({ state: 'visible', timeout: 12_000 });
	await capture('issue-3186-notification-off');

	// --- 2) ON（購読済み → 「オン」badge + 「通知をオフにする」ボタン）---
	await page.addInitScript(stubScript('granted', true));
	await page.reload();
	await page.getByTestId('notification-disable-btn').waitFor({ state: 'visible', timeout: 12_000 });
	await capture('issue-3186-notification-on');

	// --- 3) BLOCKED（permission=denied → 「ブロック中」badge + 案内文、ボタンなし）---
	await page.addInitScript(stubScript('denied', false));
	await page.reload();
	await page
		.getByTestId('notification-blocked-note')
		.waitFor({ state: 'visible', timeout: 12_000 });
	await capture('issue-3186-notification-blocked');
};
