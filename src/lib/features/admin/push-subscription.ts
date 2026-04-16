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

	// サーバーに購読情報を送信
	const keys = subscription.toJSON().keys;
	await fetch('/api/v1/notifications/subscribe', {
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

	return subscription;
}

/** プッシュ通知の購読を解除 */
async function unsubscribeFromPush(): Promise<boolean> {
	if (!isPushSupported()) return false;

	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.getSubscription();
	if (!subscription) return false;

	await subscription.unsubscribe();

	// サーバーに解除を通知
	await fetch('/api/v1/notifications/unsubscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint: subscription.endpoint }),
	});

	return true;
}

