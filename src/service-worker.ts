/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE_NAME = `ganbari-quest-${version}`;

// ビルド生成物 + 静的ファイル（大きなファイルは除外）
const PRECACHE_ASSETS = [
	...build,
	...files.filter((f) => !f.startsWith('/uploads/') && !f.startsWith('/sounds/')),
];

// インストール: 静的アセットをキャッシュ
sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(PRECACHE_ASSETS))
			.then(() => sw.skipWaiting()),
	);
});

// アクティベート: 古いキャッシュを削除
sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
			)
			.then(() => sw.clients.claim()),
	);
});

// フェッチ: Network-first (API/ページ), Cache-first (静的アセット)
sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// 同一オリジンのみ処理
	if (url.origin !== location.origin) return;

	// API リクエスト: ネットワークのみ（キャッシュしない）
	if (url.pathname.startsWith('/api/')) return;

	// SvelteKit 内部データエンドポイント: キャッシュしない
	// クライアントサイドナビゲーション時に __data.json を取得するが、
	// 認証リダイレクト等の一時的なレスポンスがキャッシュされると
	// 再ログイン後もリダイレクトが残留する (#332)
	if (url.pathname.endsWith('/__data.json')) return;

	// POST 等: キャッシュ対象外
	if (request.method !== 'GET') return;

	// 認証必要ページ: ネットワークのみ（キャッシュからのリダイレクト残留を防止）
	if (
		url.pathname.startsWith('/admin') ||
		url.pathname.startsWith('/auth') ||
		url.pathname.startsWith('/login')
	) {
		return;
	}

	// ページナビゲーション: Network-first + オフラインフォールバック
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(() => caches.match(request).then((r) => r ?? caches.match('/'))),
		);
		return;
	}

	// 静的アセット: Cache-first
	if (PRECACHE_ASSETS.includes(url.pathname)) {
		event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
		return;
	}

	// その他: Network-first (stale-while-revalidate)
	event.respondWith(
		caches.match(request).then((cached) => {
			const fetched = fetch(request).then((response) => {
				if (response.ok) {
					const clone = response.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
				}
				return response;
			});
			return cached ?? fetched;
		}),
	);
});

// ============================================================
// プッシュ通知: 受信
// ============================================================
sw.addEventListener('push', (event) => {
	if (!event.data) return;
	try {
		const payload = event.data.json() as {
			title?: string;
			body?: string;
			data?: Record<string, unknown>;
		};
		event.waitUntil(
			sw.registration.showNotification(payload.title ?? 'がんばりクエスト', {
				body: payload.body ?? '',
				icon: '/icons/icon-192.png',
				badge: '/icons/icon-192.png',
				data: payload.data ?? {},
				tag: String((payload.data as Record<string, unknown>)?.type ?? 'default'),
				renotify: true,
			}),
		);
	} catch {
		event.waitUntil(
			sw.registration.showNotification('がんばりクエスト', {
				body: event.data.text(),
				icon: '/icons/icon-192.png',
			}),
		);
	}
});

// ============================================================
// プッシュ通知: クリック時のナビゲーション
// ============================================================
sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const targetUrl = '/';
	event.waitUntil(
		sw.clients.matchAll({ type: 'window' }).then((clients) => {
			for (const client of clients) {
				if (client.url.includes(targetUrl) && 'focus' in client) {
					return (client as WindowClient).focus();
				}
			}
			return sw.clients.openWindow(targetUrl);
		}),
	);
});
