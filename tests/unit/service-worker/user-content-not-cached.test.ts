// tests/unit/service-worker/user-content-not-cached.test.ts
// 認証済み user-content (子供の顔写真 / 仮アバター) が Service Worker の Cache Storage に
// 入らないことを behavioral に固定する。
//
// なぜ必要か: Cache Storage は `Cache-Control` を一切解釈しない。`/tenants/*` と `/uploads/*` が
// service-worker.ts の最終分岐 (Network-first / stale-while-revalidate) に落ちていると、
//   ① origin が付けた `private, max-age=…` が無効化される (本 PR の修正が最も効いてほしい経路で無効)
//   ② `cached ?? fetched` なので、仮アバターを再生成しても古い画像が返り続ける
//   ③ ログアウト / 別テナントのログインで消える経路がなく、共用端末に前の家庭の顔写真が残る
// という 3 つが同時に成立する。route 側の Cache-Control fitness
// (`tests/unit/architecture/user-content-delivery-headers-fitness.test.ts`) は SW 層を見ないため、
// 本 test が対になる層を担う。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$service-worker', () => ({
	build: ['/_app/immutable/entry/app.js'],
	files: ['/favicon.png'],
	version: 'test-version',
}));

type FetchHandler = (event: {
	request: Request;
	respondWith: (r: Promise<Response> | Response) => void;
}) => void;

const ORIGIN = 'http://localhost:3000';

/** Cache Storage の stub。`put` された Request の URL を記録する。 */
function createCachesStub() {
	const put = vi.fn((_request: Request, _response: Response) => Promise.resolve());
	const cache = { put, addAll: vi.fn(() => Promise.resolve()), match: vi.fn() };
	return {
		put,
		api: {
			open: vi.fn(() => Promise.resolve(cache)),
			match: vi.fn(() => Promise.resolve(undefined)),
			keys: vi.fn(() => Promise.resolve([])),
			delete: vi.fn(() => Promise.resolve(true)),
		},
	};
}

let fetchHandler: FetchHandler;
let cachesStub: ReturnType<typeof createCachesStub>;

beforeEach(async () => {
	vi.resetModules();
	cachesStub = createCachesStub();

	const handlers = new Map<string, FetchHandler>();
	vi.spyOn(window, 'addEventListener').mockImplementation(((
		type: string,
		handler: FetchHandler,
	) => {
		handlers.set(type, handler);
	}) as typeof window.addEventListener);

	vi.stubGlobal('caches', cachesStub.api);
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.resolve(new Response('bytes', { status: 200 }))),
	);
	// service-worker.ts は `self` を ServiceWorkerGlobalScope として使う (jsdom では window)。
	vi.stubGlobal('skipWaiting', vi.fn());
	Object.assign(window, { skipWaiting: vi.fn(), clients: { claim: vi.fn() } });

	await import('../../../src/service-worker');

	const handler = handlers.get('fetch');
	if (!handler) throw new Error('service-worker.ts が fetch handler を登録していない');
	fetchHandler = handler;
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** fetch handler に GET を流し、SW が「処理を引き受けたか (respondWith)」を返す。 */
function dispatchGet(path: string): { handled: boolean; settled: Promise<unknown> } {
	let settled: Promise<unknown> = Promise.resolve();
	let handled = false;
	fetchHandler({
		request: new Request(`${ORIGIN}${path}`),
		respondWith: (r) => {
			handled = true;
			settled = Promise.resolve(r);
		},
	});
	return { handled, settled };
}

describe('service worker が認証済み user-content を Cache Storage に入れない (#4429)', () => {
	it.each([
		['/tenants/t-1/avatars/3/3f2b0c8e-0000-4000-8000-000000000000.png', 'アップロード写真'],
		['/tenants/t-1/avatars/3/placeholder.svg', '仮アバター (固定名)'],
		['/tenants/t-1/voices/3/9a7c.mp3', '録音'],
		['/uploads/avatars/avatar-3-abc.png', 'legacy flat アバター'],
	])('%s (%s) を cache.put しない', async (path) => {
		const { handled, settled } = dispatchGet(path);
		await settled;
		await vi.waitFor(() => {
			expect(
				cachesStub.put,
				'Cache Storage は Cache-Control を解釈しないため、認証済みアセットを入れてはならない',
			).not.toHaveBeenCalled();
		});
		// SW が respondWith しない = ブラウザの HTTP cache (Cache-Control 準拠) に委ねる。
		expect(
			handled,
			'SW は認証済みアセットの応答を引き受けない (network + HTTP cache に委ねる)',
		).toBe(false);
	});

	it('非トートロジー証明: 除外対象外のパスは従来どおり cache.put される', async () => {
		// この control が緑である限り「そもそも cache.put が呼ばれない test」ではないことが示される。
		const { handled, settled } = dispatchGet('/sounds/levelup.mp3');
		await settled;
		expect(handled).toBe(true);
		await vi.waitFor(() => {
			expect(cachesStub.put).toHaveBeenCalled();
		});
		expect(cachesStub.put.mock.calls[0]?.[0].url).toBe(`${ORIGIN}/sounds/levelup.mp3`);
	});
});
