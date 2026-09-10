// tests/unit/routes/setup-trial-started-notice.test.ts
//
// **自動で開始した無料体験を、顧客に見える形で告げているか** (PO 決裁 2026-09-10 決定 3(a))。
//
// ## なぜ要るか
//
// 申込経路 (`/pricing` → `?plan=`) から来た顧客のトライアルは**自動で始まる**。
// 始まったことを告げないと、顧客は自分で開始した覚えの無いまま体験が進み、
// あとで「無料体験を始める」を押して「すでに使用済みです」に当たる。
// **1 世帯 1 回きり**なので、これは取り返しがつかない。
//
// ## 固定する不変条件
//
//   [T1] 開始できたときだけ着地先に `?trialStarted=1` が付く
//   [T2] 開始できなかった (既に使用済み / plan 無し / 非 owner) ときは付かない
//        — 始まっていないのに「始まりました」と出さない
//   [T3] 既に query を持つ着地先でも壊さない (`&` で継ぐ)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStartTrial = vi.fn();
vi.mock('$lib/server/services/trial-service', () => ({
	startTrial: (...args: unknown[]) => mockStartTrial(...args),
	TRIAL_TIER: 'premium',
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { GET } = await import('../../../src/routes/auth/oauth/trial-start/+server');

/** SvelteKit の `redirect()` は throw するので、Location を例外から取り出す。 */
async function locationOf(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();
	} catch (e) {
		const location = (e as { location?: unknown })?.location;
		if (typeof location === 'string') return location;
		throw e;
	}
	throw new Error('redirect が発生しなかった');
}

function makeEvent(opts: { plan?: string; next?: string; role?: string } = {}) {
	const url = new URL('https://x/auth/oauth/trial-start');
	if (opts.next) url.searchParams.set('next', opts.next);
	return {
		url,
		cookies: {
			get: () => opts.plan ?? undefined,
			delete: vi.fn(),
		},
		locals: { context: { tenantId: 't-1', role: opts.role ?? 'owner' } },
		// biome-ignore lint/suspicious/noExplicitAny: minimal RequestEvent stub for handler unit test
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockStartTrial.mockResolvedValue(true);
});

describe('[T1] 開始できたときだけ告知の旗を付ける', () => {
	it('startTrial が true なら ?trialStarted=1 が付く', async () => {
		const location = await locationOf(() => GET(makeEvent({ plan: 'standard' })));
		expect(location).toBe('/admin?trialStarted=1');
	});
});

describe('[T2] 始まっていないときは付けない', () => {
	it('startTrial が false (既に使用済み) なら付かない', async () => {
		mockStartTrial.mockResolvedValue(false);
		const location = await locationOf(() => GET(makeEvent({ plan: 'standard' })));
		expect(location, '始まっていないのに「始まりました」と出すと、顧客は残り日数を誤解する').toBe(
			'/admin',
		);
	});

	it('plan cookie が無ければ startTrial 自体を呼ばず、旗も付かない', async () => {
		const location = await locationOf(() => GET(makeEvent({})));
		expect(mockStartTrial).not.toHaveBeenCalled();
		expect(location).toBe('/admin');
	});

	it('owner 以外は開始しない (世帯の 1 回きりを消費させない) ので旗も付かない', async () => {
		const location = await locationOf(() => GET(makeEvent({ plan: 'standard', role: 'parent' })));
		expect(mockStartTrial).not.toHaveBeenCalled();
		expect(location).toBe('/admin');
	});

	it('startTrial が throw しても着地はする (告知だけ落とす)', async () => {
		mockStartTrial.mockRejectedValue(new Error('boom'));
		const location = await locationOf(() => GET(makeEvent({ plan: 'standard' })));
		expect(location).toBe('/admin');
	});
});

describe('[T3] 既に query を持つ着地先を壊さない', () => {
	it('`?from=setup` 付きの着地先には & で継ぐ', async () => {
		const location = await locationOf(() =>
			GET(makeEvent({ plan: 'standard', next: '/admin?from=setup' })),
		);
		expect(location).toBe('/admin?from=setup&trialStarted=1');
	});
});
