/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// `renotify` は Notification API の正式オプションだが TS の DOM lib 型 (`NotificationOptions`) には
// 無く、webworker lib のみが持つ。本 file を test から import すると DOM lib 側の型で検査されるため、
// SW 実行時に有効なオプションを型で明示する。
type PushNotificationOptions = NotificationOptions & { renotify?: boolean };
const CACHE_NAME = `ganbari-quest-${version}`;

// #4644: オフライン時の navigate 着地先。prerender されているので precache に載る。
// 値を直書きせず定数化して、下の PRECACHE_ASSETS / フォールバック / test が同じ 1 箇所を
// 参照するようにする (パスがずれると「precache していないページに fallback する」= 無効になる)。
export const OFFLINE_FALLBACK_PATH = '/offline';

// ビルド生成物 + 静的ファイル（大きなファイルは除外） + prerender 済みページ
//
// #4644: `prerendered` を precache に含める。ここに `/offline` が入らないと、オフライン時の
// フォールバック先そのものがキャッシュに無く、AC の「オフラインで /offline が出る」が
// 成立しない。prerender 済みページは静的 HTML で個人情報を含まないため、
// `/tenants/` `/uploads/` (認証済 user-content、#3133) のような除外は不要。
const PRECACHE_ASSETS = [
	...build,
	...files.filter((f) => !f.startsWith('/uploads/') && !f.startsWith('/sounds/')),
	...prerendered,
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

	// 認証済みアセット (子供の顔写真 / 仮アバター / 音声): キャッシュしない
	//
	// Cache Storage は `Cache-Control` を**一切解釈しない**。ここに入れてしまうと origin が付けた
	// `private, max-age=…` が無効化され、下の Network-first 分岐が `cached ?? fetched` で
	// 端末に残ったバイトを無期限に返し続ける (= ログアウトしても、別の保護者が同じ端末で
	// ログインしても、前の家庭の子供の顔写真が表示され得る)。`private` は準拠した共有キャッシュに
	// しか効かず、device-local な Cache Storage には無力なため、経路ごと除外するしかない。
	//
	// これらは `/tenants/[...path]` / `/uploads/avatars/[filename]` が認証 + tenant 一致 (#3133) を
	// 通してから配信する user-content であり、`/api/` や `/admin` と同じ「キャッシュ対象外」に属する。
	// ブラウザの HTTP cache (Cache-Control 準拠) は従来どおり効くので、再表示は速いまま。
	if (url.pathname.startsWith('/tenants/') || url.pathname.startsWith('/uploads/')) return;

	// ページナビゲーション: Network-first + `/offline` へのフォールバック (#4644)
	//
	// 旧実装は失敗時に `caches.match(request)` → `caches.match('/')` の順で **stale な
	// ページを返していた**。これは子供の画面では実害になる:
	//   - 前回のポイント / スタンプがそのまま出るため、記録できていないのに「できた」ように見える
	//   - `/` のキャッシュはリダイレクト応答やログイン画面を掴んでいることがあり、白画面になる
	// オフラインは「今つながっていない」という状態であって「前の画面をもう一度見せる」場面では
	// ないため、常に説明のある `/offline` に着地させる (ひらがな文面、OFFLINE_LABELS が SSOT)。
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(
				async () =>
					(await caches.match(OFFLINE_FALLBACK_PATH)) ??
					// precache 前 (= SW install 完了前) にオフラインになった場合の最終手段。
					// `undefined` を respondWith すると TypeError で握り潰されブラウザ既定の
					// エラー画面になるため、明示的に応答を返す。
					new Response('オフラインのため表示できません', {
						status: 503,
						headers: { 'Content-Type': 'text/plain; charset=utf-8' },
					}),
			),
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
		const options: PushNotificationOptions = {
			body: payload.body ?? '',
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png',
			data: payload.data ?? {},
			tag: String((payload.data as Record<string, unknown>)?.type ?? 'default'),
			renotify: true,
		};
		event.waitUntil(sw.registration.showNotification(payload.title ?? 'がんばりクエスト', options));
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
