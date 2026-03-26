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

	// POST 等: キャッシュ対象外
	if (request.method !== 'GET') return;

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
