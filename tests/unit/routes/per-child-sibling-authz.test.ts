// tests/unit/routes/per-child-sibling-authz.test.ts
//
// 「child ロールが **兄弟の childId** を指定したら 403 になる」ことを、per-child endpoint ごとに
// 実際にハンドラを呼んで確かめる振る舞いテスト。
//
// `tests/unit/architecture/per-child-route-authz-fitness.test.ts` は「guard を呼んでいるか」という
// 静的な適用範囲を見る。本テストは「呼んだ結果ちゃんと拒否されるか」を見る。両方ないと、
// guard を呼んでいるが引数が間違っている (例: 自分の childId を渡している) 実装が緑で通る。
// `export-authz-symmetry-3246.test.ts` の (A)/(B) 2 段構成と同型。
//
// 併せて owner / parent が従来どおり全 child に到達できること (= 塞ぎすぎていないこと) も固定する。
// 403 以外なら通過とみなす — gate の先で DB が無くて落ちるのは本テストの主張ではない。

import { beforeAll, describe, expect, it } from 'vitest';
import { asChildId } from '$lib/domain/ids';

/** 自分 (child ロールのセッションが紐づく子供) */
const SELF = '1';
/** 兄弟 (別の子供)。ここに到達できてはいけない */
const SIBLING = '99';

function childLocals(): App.Locals {
	return {
		authenticated: true,
		identity: { type: 'cognito', userId: 'u-child', email: 'c@example.com' },
		context: { tenantId: 't-1', role: 'child', childId: asChildId(SELF) },
	} as unknown as App.Locals;
}

function parentLocals(): App.Locals {
	return {
		authenticated: true,
		identity: { type: 'cognito', userId: 'u-parent', email: 'p@example.com' },
		context: { tenantId: 't-1', role: 'parent' },
	} as unknown as App.Locals;
}

/** child ロールだが子供レコードに紐づいていない (childId 未解決) セッション */
function unlinkedChildLocals(): App.Locals {
	return {
		authenticated: true,
		identity: { type: 'cognito', userId: 'u-child', email: 'c@example.com' },
		context: { tenantId: 't-1', role: 'child' },
	} as unknown as App.Locals;
}

interface Invocation {
	/** 表示名 (失敗時にどの endpoint か分かるように) */
	name: string;
	/** route module のパス (本 file からの相対) */
	mod: string;
	/** 呼ぶ HTTP メソッド */
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	/** childId を差し込んで RequestEvent 相当を作る */
	event: (childId: string) => Record<string, unknown>;
}

function jsonRequest(body: unknown): { request: { json: () => Promise<unknown> } } {
	return { request: { json: async () => body } };
}

function formRequest(entries: Record<string, string>): {
	request: { formData: () => Promise<FormData> };
} {
	return {
		request: {
			formData: async () => {
				const fd = new FormData();
				for (const [k, v] of Object.entries(entries)) fd.set(k, v);
				return fd;
			},
		},
	};
}

/** cookie から childId を取る endpoint 用 */
function cookies(childId: string): { cookies: { get: (name: string) => string | undefined } } {
	return { cookies: { get: (name) => (name === 'selectedChildId' ? childId : undefined) } };
}

const INVOCATIONS: Invocation[] = [
	{
		name: 'GET /api/v1/points/[childId]',
		mod: '../../../src/routes/api/v1/points/[childId]/+server',
		method: 'GET',
		event: (childId) => ({ params: { childId } }),
	},
	{
		name: 'GET /api/v1/points/[childId]/history',
		mod: '../../../src/routes/api/v1/points/[childId]/history/+server',
		method: 'GET',
		event: (childId) => ({ params: { childId }, url: new URL('http://x/') }),
	},
	{
		name: 'GET /api/v1/status/[childId]',
		mod: '../../../src/routes/api/v1/status/[childId]/+server',
		method: 'GET',
		event: (childId) => ({ params: { childId } }),
	},
	{
		name: 'GET /api/v1/evaluations/[childId]',
		mod: '../../../src/routes/api/v1/evaluations/[childId]/+server',
		method: 'GET',
		event: (childId) => ({ params: { childId }, url: new URL('http://x/') }),
	},
	{
		name: 'GET /api/v1/login-bonus/[childId]',
		mod: '../../../src/routes/api/v1/login-bonus/[childId]/+server',
		method: 'GET',
		event: (childId) => ({ params: { childId } }),
	},
	{
		name: 'POST /api/v1/login-bonus/[childId]/claim',
		mod: '../../../src/routes/api/v1/login-bonus/[childId]/claim/+server',
		method: 'POST',
		event: (childId) => ({ params: { childId } }),
	},
	{
		name: 'GET /api/v1/messages/[childId]',
		mod: '../../../src/routes/api/v1/messages/[childId]/+server',
		method: 'GET',
		event: (childId) => ({ params: { childId }, url: new URL('http://x/') }),
	},
	{
		name: 'POST /api/v1/messages/[childId]',
		mod: '../../../src/routes/api/v1/messages/[childId]/+server',
		method: 'POST',
		event: (childId) => ({
			params: { childId },
			...jsonRequest({ messageType: 'stamp', stampCode: 'good' }),
		}),
	},
	{
		name: 'POST /api/v1/messages/[messageId]/shown',
		mod: '../../../src/routes/api/v1/messages/[messageId]/shown/+server',
		method: 'POST',
		event: (childId) => ({ params: { messageId: 'm-1' }, ...cookies(childId) }),
	},
	{
		name: 'GET /api/v1/special-rewards/[childId]',
		mod: '../../../src/routes/api/v1/special-rewards/[childId]/+server',
		method: 'GET',
		event: (childId) => ({ params: { childId } }),
	},
	{
		name: 'POST /api/v1/special-rewards/[childId]',
		mod: '../../../src/routes/api/v1/special-rewards/[childId]/+server',
		method: 'POST',
		event: (childId) => ({
			params: { childId },
			...jsonRequest({ title: 'ごほうび', points: 100, category: 'other' }),
		}),
	},
	{
		name: 'POST /api/v1/special-rewards/[rewardId]/shown',
		mod: '../../../src/routes/api/v1/special-rewards/[rewardId]/shown/+server',
		method: 'POST',
		event: (childId) => ({ params: { rewardId: 'r-1' }, ...cookies(childId) }),
	},
	{
		name: 'GET /api/v1/battle/[childId]',
		mod: '../../../src/routes/api/v1/battle/[childId]/+server',
		method: 'GET',
		event: (childId) => ({ params: { childId } }),
	},
	{
		name: 'POST /api/v1/battle/[childId]',
		mod: '../../../src/routes/api/v1/battle/[childId]/+server',
		method: 'POST',
		event: (childId) => ({ params: { childId } }),
	},
	{
		name: 'POST /api/v1/children/[id]/avatar',
		mod: '../../../src/routes/api/v1/children/[id]/avatar/+server',
		method: 'POST',
		event: (childId) => ({ params: { id: childId }, ...formRequest({}) }),
	},
	{
		name: 'GET /api/v1/children/[id]/voices',
		mod: '../../../src/routes/api/v1/children/[id]/voices/+server',
		method: 'GET',
		event: (childId) => ({ params: { id: childId }, url: new URL('http://x/') }),
	},
	{
		name: 'POST /api/v1/children/[id]/voices',
		mod: '../../../src/routes/api/v1/children/[id]/voices/+server',
		method: 'POST',
		event: (childId) => ({ params: { id: childId }, ...formRequest({ label: 'こえ' }) }),
	},
	{
		name: 'PATCH /api/v1/children/[id]/voices/[voiceId]',
		mod: '../../../src/routes/api/v1/children/[id]/voices/[voiceId]/+server',
		method: 'PATCH',
		event: (childId) => ({
			params: { id: childId, voiceId: 'v-1' },
			...jsonRequest({ scene: 'complete' }),
		}),
	},
	{
		name: 'DELETE /api/v1/children/[id]/voices/[voiceId]',
		mod: '../../../src/routes/api/v1/children/[id]/voices/[voiceId]/+server',
		method: 'DELETE',
		event: (childId) => ({ params: { id: childId, voiceId: 'v-1' } }),
	},
	{
		name: 'POST /api/v1/children/[id]/activities/[activityId]/pin',
		mod: '../../../src/routes/api/v1/children/[id]/activities/[activityId]/pin/+server',
		method: 'POST',
		event: (childId) => ({
			params: { id: childId, activityId: 'a-1' },
			...jsonRequest({ pinned: true }),
		}),
	},
	{
		name: 'DELETE /api/v1/children/[id]/activities/[activityId]/pin',
		mod: '../../../src/routes/api/v1/children/[id]/activities/[activityId]/pin/+server',
		method: 'DELETE',
		event: (childId) => ({ params: { id: childId, activityId: 'a-1' } }),
	},
	{
		name: 'POST /api/v1/activity-logs (body childId)',
		mod: '../../../src/routes/api/v1/activity-logs/+server',
		method: 'POST',
		event: (childId) => jsonRequest({ childId, activityId: 'a-1' }),
	},
	{
		name: 'GET /api/v1/activity-logs?childId= (query childId)',
		mod: '../../../src/routes/api/v1/activity-logs/+server',
		method: 'GET',
		event: (childId) => ({ url: new URL(`http://x/?childId=${childId}`) }),
	},
	{
		name: 'POST /api/v1/points/convert (body childId)',
		mod: '../../../src/routes/api/v1/points/convert/+server',
		method: 'POST',
		event: (childId) => jsonRequest({ childId, amount: 500 }),
	},
	{
		name: 'POST /api/v1/reward-redemption-requests (body childId)',
		mod: '../../../src/routes/api/v1/reward-redemption-requests/+server',
		method: 'POST',
		event: (childId) => jsonRequest({ childId, rewardId: 'r-1' }),
	},
	{
		name: 'POST /api/v1/usage (body childId)',
		mod: '../../../src/routes/api/v1/usage/+server',
		method: 'POST',
		event: (childId) => jsonRequest({ childId }),
	},
	{
		name: 'GET /api/v1/activities?childId= (query childId)',
		mod: '../../../src/routes/api/v1/activities/+server',
		method: 'GET',
		event: (childId) => ({ url: new URL(`http://x/?childId=${childId}`) }),
	},
];

/** ハンドラを呼び、HTTP status を取り出す (throw された HttpError も status に還元する)。 */
async function callHandler(inv: Invocation, childId: string, locals: App.Locals): Promise<number> {
	const mod = (await import(inv.mod)) as Record<string, (event: unknown) => Promise<Response>>;
	const handler = mod[inv.method];
	if (!handler) throw new Error(`${inv.name}: ${inv.method} handler が無い`);
	try {
		const res = await handler({ ...inv.event(childId), locals });
		return res?.status ?? 200;
	} catch (e) {
		return (e as { status?: number })?.status ?? 500;
	}
}

describe('per-child endpoint: child ロールは兄弟の childId に到達できない', () => {
	// route module の初回 dynamic import は service / db グラフごと transform するため、
	// 既定 timeout (5s) を超えうる。it 側に猶予を配ると「本当に固まる回帰」まで待って
	// 通してしまうので、温める対象を module ロードに限定する (export-authz-symmetry と同じ扱い)。
	beforeAll(async () => {
		await Promise.all([...new Set(INVOCATIONS.map((i) => i.mod))].map((m) => import(m)));
	}, 120_000);

	for (const inv of INVOCATIONS) {
		it(`${inv.name}: 兄弟の childId は 403`, async () => {
			expect(await callHandler(inv, SIBLING, childLocals())).toBe(403);
		});
	}

	it('未紐づけ (childId 未解決) の child セッションも 403 で閉じる', async () => {
		const inv = INVOCATIONS[0] as Invocation;
		expect(await callHandler(inv, SELF, unlinkedChildLocals())).toBe(403);
	});
});

describe('per-child endpoint: parent は従来どおり全 child に到達できる (塞ぎすぎていない)', () => {
	for (const inv of INVOCATIONS) {
		it(`${inv.name}: parent は 403 にならない`, async () => {
			expect(await callHandler(inv, SIBLING, parentLocals())).not.toBe(403);
		});
	}
});
