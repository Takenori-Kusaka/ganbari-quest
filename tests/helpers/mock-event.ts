// tests/helpers/mock-event.ts
// SvelteKit RequestEvent のモックヘルパー

/**
 * vitest 用に最小限の RequestEvent モックを生成する。
 * ハンドラが利用する request / url / params だけ提供すれば十分。
 */
export function createMockEvent(opts: {
	method?: string;
	url: string;
	params?: Record<string, string>;
	body?: unknown;
	// biome-ignore lint/suspicious/noExplicitAny: RequestEvent モックは型の完全互換が不要
}): any {
	const requestUrl = new URL(opts.url, 'http://localhost');
	const init: RequestInit = { method: opts.method ?? 'GET' };

	if (opts.body !== undefined) {
		init.headers = { 'Content-Type': 'application/json' };
		init.body = JSON.stringify(opts.body);
	}

	const request = new Request(requestUrl, init);

	return {
		request,
		url: requestUrl,
		params: opts.params ?? {},
		route: { id: null },
		locals: { context: { tenantId: 'test-tenant' } },
		cookies: {
			get: () => undefined,
			set: () => {},
			delete: () => {},
			getAll: () => [],
			serialize: () => '',
		},
		platform: undefined,
		getClientAddress: () => '127.0.0.1',
		isDataRequest: false,
		isSubRequest: false,
		setHeaders: () => {},
	};
}
