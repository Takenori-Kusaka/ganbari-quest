// tests/unit/service-worker/offline-navigation-fallback.test.ts
// #4644: オフライン時のページ遷移が `/offline` (ひらがなの説明ページ) に着地することを固定する。
//
// なぜ必要か: 旧実装は navigate の fetch 失敗時に `caches.match(request)` → `caches.match('/')`
// の順で **stale なページを返していた**。子供の画面では
//   ① 前回のポイント / スタンプがそのまま出るため、記録できていないのに「できた」ように見える
//   ② `/` のキャッシュがリダイレクト応答やログイン画面を掴んでいると白画面になる
// が起きる。「つながっていない」ことを説明する着地ページに必ず落とすことを behavioral に固定する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$service-worker', () => ({
	build: ['/_app/immutable/entry/app.js'],
	files: ['/favicon.png'],
	// SvelteKit は prerender 済みページを `prerendered` として渡す。`/offline` はここに載る
	// (載らなければ precache されず、フォールバック先そのものが取得できない)。
	prerendered: ['/offline'],
	version: 'test-version',
}));

type FetchHandler = (event: {
	request: Request;
	respondWith: (r: Promise<Response> | Response) => void;
}) => void;

type InstallHandler = (event: { waitUntil: (p: Promise<unknown>) => void }) => void;

const ORIGIN = 'http://localhost:3000';

/** キャッシュ済み URL → Response を持つ Cache Storage の stub。 */
function createCachesStub(cached: Record<string, Response>) {
	const addAll = vi.fn((_assets: string[]) => Promise.resolve());
	const cache = { put: vi.fn(), addAll, match: vi.fn() };
	return {
		addAll,
		api: {
			open: vi.fn(() => Promise.resolve(cache)),
			match: vi.fn((req: Request | string) => {
				const url = typeof req === 'string' ? req : new URL(req.url).pathname;
				const key = url.startsWith('http') ? new URL(url).pathname : url;
				return Promise.resolve(cached[key]);
			}),
			keys: vi.fn(() => Promise.resolve([])),
			delete: vi.fn(() => Promise.resolve(true)),
		},
	};
}

let fetchHandler: FetchHandler;
let installHandler: InstallHandler;
let cachesStub: ReturnType<typeof createCachesStub>;

async function loadServiceWorker(options: {
	cached: Record<string, Response>;
	online: boolean;
}): Promise<void> {
	vi.resetModules();
	cachesStub = createCachesStub(options.cached);

	const handlers = new Map<string, unknown>();
	vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, handler: unknown) => {
		handlers.set(type, handler);
	}) as typeof window.addEventListener);

	vi.stubGlobal('caches', cachesStub.api);
	vi.stubGlobal(
		'fetch',
		vi.fn(() =>
			options.online
				? Promise.resolve(new Response('online page', { status: 200 }))
				: Promise.reject(new TypeError('Failed to fetch')),
		),
	);
	Object.assign(window, { skipWaiting: vi.fn(), clients: { claim: vi.fn() } });

	await import('../../../src/service-worker');

	fetchHandler = handlers.get('fetch') as FetchHandler;
	installHandler = handlers.get('install') as InstallHandler;
	if (!fetchHandler) throw new Error('service-worker.ts が fetch handler を登録していない');
}

/** navigate リクエストを流し、SW が返した Response を取り出す。 */
async function dispatchNavigate(path: string): Promise<Response | undefined> {
	let responded: Promise<Response> | Response | undefined;
	fetchHandler({
		// jsdom の Request は `mode` が getter-only で 'navigate' を作れないため、
		// service-worker.ts が実際に読む 3 つ (url / method / mode) だけを持つ最小オブジェクトを渡す。
		request: { url: `${ORIGIN}${path}`, method: 'GET', mode: 'navigate' } as unknown as Request,
		respondWith: (r) => {
			responded = r;
		},
	});
	return responded === undefined ? undefined : await responded;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('service worker のオフライン navigate フォールバック (#4644)', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('オフラインで遷移すると /offline のキャッシュを返す', async () => {
		await loadServiceWorker({
			cached: { '/offline': new Response('offline page', { status: 200 }) },
			online: false,
		});

		const response = await dispatchNavigate('/preschool/home');

		expect(response, 'navigate は SW が応答を引き受ける').toBeDefined();
		expect(await response?.text()).toBe('offline page');
		expect(response?.status).toBe(200);
	});

	it('stale なページキャッシュがあっても /offline を優先する (古いポイントを見せない)', async () => {
		await loadServiceWorker({
			cached: {
				// 旧実装はこの 2 つのどちらかを返していた。
				'/preschool/home': new Response('stale home', { status: 200 }),
				'/': new Response('stale root', { status: 200 }),
				'/offline': new Response('offline page', { status: 200 }),
			},
			online: false,
		});

		const body = await (await dispatchNavigate('/preschool/home'))?.text();

		expect(body, 'stale なページを返してはならない').not.toBe('stale home');
		expect(body).not.toBe('stale root');
		expect(body).toBe('offline page');
	});

	it('/offline も未キャッシュなら 503 の説明応答を返す (undefined を respondWith しない)', async () => {
		await loadServiceWorker({ cached: {}, online: false });

		const response = await dispatchNavigate('/preschool/home');

		expect(response?.status).toBe(503);
		expect(await response?.text()).toContain('オフライン');
	});

	it('非トートロジー証明: オンラインならネットワーク応答をそのまま返す', async () => {
		await loadServiceWorker({
			cached: { '/offline': new Response('offline page', { status: 200 }) },
			online: true,
		});

		expect(await (await dispatchNavigate('/preschool/home'))?.text()).toBe('online page');
	});

	it('precache に /offline (prerendered) を含める', async () => {
		await loadServiceWorker({ cached: {}, online: true });

		let installed: Promise<unknown> = Promise.resolve();
		installHandler({
			waitUntil: (p) => {
				installed = p;
			},
		});
		await installed;

		expect(cachesStub.addAll).toHaveBeenCalled();
		const assets = cachesStub.addAll.mock.calls[0]?.[0] ?? [];
		expect(
			assets,
			'フォールバック先が precache に載っていないと オフライン時に取得できない',
		).toContain('/offline');
	});
});
