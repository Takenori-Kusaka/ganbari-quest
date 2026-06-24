// src/lib/features/admin/push-subscription.ts
// クライアントサイド Web Push 購読管理ユーティリティ

/** ブラウザが Web Push をサポートしているか */
export function isPushSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

/** 現在の通知許可状態を取得 */
export function getNotificationPermission(): NotificationPermission {
	if (!isPushSupported()) return 'denied';
	return Notification.permission;
}

/**
 * #3186: ユーザ向け通知ステータス (内部の permission↔subscription 差を隠蔽した 4 値)。
 *   - `unsupported`: Web Push API 非対応 (secure context 外 / 非対応ブラウザ)
 *   - `blocked`: ブラウザでブロック (permission='denied')
 *   - `off`: 未購読 (permission='default' or 'granted' で subscription 無し — 内部差は隠す)
 *   - `on`: 購読済み
 */
export type PushStatus = 'unsupported' | 'blocked' | 'off' | 'on';

/**
 * #3186: 同期判定できる範囲で即座に状態を返す (await なし)。
 * `unsupported` / `blocked` は同期確定。granted/default は購読確認前のため `off` 扱い。
 * UI は本値で即描画し、`getPushStatus()` の非同期確認で `on` のみ後追い更新する。
 * これにより `serviceWorker` 待ちで 'checking' のまま固まる事故を防ぐ。
 */
export function getPushStatusSync(): Exclude<PushStatus, 'on'> {
	if (!isPushSupported()) return 'unsupported';
	if (Notification.permission === 'denied') return 'blocked';
	return 'off';
}

export async function getPushStatus(): Promise<PushStatus> {
	const sync = getPushStatusSync();
	if (sync !== 'off') return sync;
	// 購読有無のみ非同期確認。getRegistration() は即時解決 (未登録なら undefined)。
	const registration = await navigator.serviceWorker.getRegistration();
	if (!registration) return 'off';
	const subscription = await registration.pushManager.getSubscription();
	return subscription ? 'on' : 'off';
}

/** 通知許可をリクエスト */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
	if (!isPushSupported()) return 'denied';
	return Notification.requestPermission();
}

/** VAPID 公開鍵をサーバーから取得 */
async function getVapidPublicKey(): Promise<string> {
	const res = await fetch('/api/v1/settings/vapid-key');
	if (!res.ok) throw new Error('VAPID key fetch failed');
	const data = (await res.json()) as { publicKey: string };
	return data.publicKey;
}

/** Base64 URL を Uint8Array に変換（VAPID鍵用） */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; i++) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

/** プッシュ通知を購読 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
	if (!isPushSupported()) return null;

	const permission = await requestNotificationPermission();
	if (permission !== 'granted') return null;

	const registration = await navigator.serviceWorker.ready;
	const vapidKey = await getVapidPublicKey();
	if (!vapidKey) return null;

	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
	});

	// サーバーに購読情報を送信 (#2115 AC6: silent 失敗防止のため .ok を必ず判定)
	const keys = subscription.toJSON().keys;
	const res = await fetch('/api/v1/notifications/subscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			endpoint: subscription.endpoint,
			keys: {
				p256dh: keys?.p256dh ?? '',
				auth: keys?.auth ?? '',
			},
		}),
	});

	if (!res.ok) {
		// サーバー保存失敗時はブラウザ側 subscription も解除して整合性維持
		await subscription.unsubscribe().catch(() => undefined);
		throw new Error(`subscribe API failed: ${res.status}`);
	}

	return subscription;
}

/**
 * プッシュ通知の購読を解除。
 * #2320 (EPIC #2319 ①): /admin/settings/notifications/+page.svelte の通知 toggle UI で
 * 利用するため public export に変更。旧 plain `<script>` ブロックでは dynamic import が
 * 型チェック対象外で通っていたが、Svelte 5 では `<script lang="ts">` 統合 + onMount 内
 * dynamic import になるため export 公開が必要。
 */
export async function unsubscribeFromPush(): Promise<boolean> {
	if (!isPushSupported()) return false;

	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.getSubscription();
	if (!subscription) return false;

	await subscription.unsubscribe();

	// サーバーに解除を通知 (#2115 AC6 / #3186: silent 失敗防止のため .ok を必ず判定。
	// 非 2xx をそのまま return true で握り潰すと、ブラウザは解除済みなのに
	// サーバー側 subscription 行が残り、停止済みエンドポイントへ push し続ける)
	const res = await fetch('/api/v1/notifications/unsubscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint: subscription.endpoint }),
	});

	if (!res.ok) {
		throw new Error(`unsubscribe API failed: ${res.status}`);
	}

	return true;
}
