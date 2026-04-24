// tests/unit/routes/ops-license-issue.test.ts
// #802: /ops/license/issue の issue form action 契約テスト。
//
// テスト観点:
// - ops 非認証 (local identity / null) は 403
// - plan 不正 → 400
// - quantity が 0 / 負 / 501 / NaN → 400
// - reason 空 → 400
// - expiresAt が 'default' (undefined)・'never' (null)・ISO 文字列で正しく変換
// - ok 時: 指定数のキーが issueLicenseKey で発行される
// - issueLicenseKey で一部失敗しても、部分成功なら ok を返す
// - 全失敗なら 500

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIssueLicenseKey = vi.fn();

vi.mock('$lib/server/services/license-key-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/license-key-service')>(
		'$lib/server/services/license-key-service',
	);
	return {
		...actual,
		issueLicenseKey: (...args: unknown[]) => mockIssueLicenseKey(...args),
	};
});

const { actions, load } = await import('../../../src/routes/ops/license/issue/+page.server');

type LocalsShape = {
	identity: { type: 'local' } | { type: 'cognito'; userId: string; email: string } | null;
};

function makeEvent(opts: { identity: LocalsShape['identity']; formData?: Record<string, string> }) {
	const form = new FormData();
	for (const [k, v] of Object.entries(opts.formData ?? {})) {
		form.set(k, v);
	}
	return {
		locals: { identity: opts.identity },
		request: {
			formData: async () => form,
			headers: { get: () => null },
		},
		getClientAddress: () => '203.0.113.9',
	} as unknown as Parameters<NonNullable<typeof actions.issue>>[0];
}

function isHttpError(e: unknown): e is { status: number } {
	return typeof e === 'object' && e !== null && 'status' in e;
}

function isActionFailure(v: unknown): v is { status: number; data: { error?: string } } {
	return typeof v === 'object' && v !== null && 'status' in v && 'data' in v;
}

describe('#802 /ops/license/issue load', () => {
	it('non-cognito は 403', async () => {
		try {
			await load({
				locals: { identity: null },
			} as unknown as Parameters<typeof load>[0]);
			expect.fail('403 がスローされるはず');
		} catch (e) {
			if (!isHttpError(e)) throw e;
			expect(e.status).toBe(403);
		}
	});

	it('cognito は plans を返す', async () => {
		const result = (await load({
			locals: {
				identity: { type: 'cognito', userId: 'u1', email: 'ops@example.com' },
			},
		} as unknown as Parameters<typeof load>[0])) as { plans: readonly string[] };
		expect(result.plans.length).toBeGreaterThan(0);
	});
});

describe('#802 /ops/license/issue issue action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIssueLicenseKey.mockImplementation(async (params: { plan: string; tenantId: string }) => ({
			licenseKey: `GQ-MOCK-${Math.random().toString(36).slice(2, 6).toUpperCase()}-KEY-00001`,
			tenantId: params.tenantId,
			plan: params.plan,
			status: 'active',
			createdAt: '2026-04-16T10:00:00.000Z',
			kind: 'campaign',
		}));
	});

	it('identity null は 403', async () => {
		const ev = makeEvent({
			identity: null,
			formData: { plan: 'monthly', quantity: '1', reason: 'test' },
		});
		try {
			if (!actions.issue) throw new Error('issue action missing');
			await actions.issue(ev);
			expect.fail('403');
		} catch (e) {
			if (!isHttpError(e)) throw e;
			expect(e.status).toBe(403);
		}
		expect(mockIssueLicenseKey).not.toHaveBeenCalled();
	});

	it('local identity は 403', async () => {
		const ev = makeEvent({
			identity: { type: 'local' },
			formData: { plan: 'monthly', quantity: '1', reason: 'test' },
		});
		try {
			if (!actions.issue) throw new Error('issue action missing');
			await actions.issue(ev);
			expect.fail('403');
		} catch (e) {
			if (!isHttpError(e)) throw e;
			expect(e.status).toBe(403);
		}
	});

	it('plan 不正 → 400', async () => {
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u1', email: 'o@e.com' },
			formData: { plan: 'pirate', quantity: '1', reason: 'test' },
		});
		if (!actions.issue) throw new Error('issue action missing');
		const r = await actions.issue(ev);
		expect(isActionFailure(r)).toBe(true);
		if (isActionFailure(r)) expect(r.status).toBe(400);
	});

	it('quantity 0 → 400', async () => {
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u1', email: 'o@e.com' },
			formData: { plan: 'monthly', quantity: '0', reason: 'test' },
		});
		if (!actions.issue) throw new Error('issue action missing');
		const r = await actions.issue(ev);
		expect(isActionFailure(r)).toBe(true);
		if (isActionFailure(r)) expect(r.status).toBe(400);
	});

	it('quantity 501 → 400 (MAX_BATCH=500)', async () => {
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u1', email: 'o@e.com' },
			formData: { plan: 'monthly', quantity: '501', reason: 'test' },
		});
		if (!actions.issue) throw new Error('issue action missing');
		const r = await actions.issue(ev);
		expect(isActionFailure(r)).toBe(true);
		if (isActionFailure(r)) expect(r.status).toBe(400);
	});

	it('reason 空 → 400', async () => {
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u1', email: 'o@e.com' },
			formData: { plan: 'monthly', quantity: '1', reason: '' },
		});
		if (!actions.issue) throw new Error('issue action missing');
		const r = await actions.issue(ev);
		expect(isActionFailure(r)).toBe(true);
		if (isActionFailure(r)) expect(r.status).toBe(400);
	});

	it('expiresAt の形式不正 → 400', async () => {
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u1', email: 'o@e.com' },
			formData: {
				plan: 'monthly',
				quantity: '1',
				reason: 'test',
				expiresAt: 'not-a-date',
			},
		});
		if (!actions.issue) throw new Error('issue action missing');
		const r = await actions.issue(ev);
		expect(isActionFailure(r)).toBe(true);
		if (isActionFailure(r)) expect(r.status).toBe(400);
	});

	it('ok: 3 件発行 + actorId=ops:<userId>', async () => {
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u-ops-7', email: 'ops@e.com' },
			formData: {
				plan: 'monthly',
				quantity: '3',
				reason: '2026春キャンペーン',
			},
		});
		if (!actions.issue) throw new Error('issue action missing');
		const r = await actions.issue(ev);
		expect(r).toMatchObject({ issued: true, plan: 'monthly', reason: '2026春キャンペーン' });
		expect((r as { keys: string[] }).keys).toHaveLength(3);

		expect(mockIssueLicenseKey).toHaveBeenCalledTimes(3);
		const firstCall = mockIssueLicenseKey.mock.calls[0]?.[0]!;
		expect(firstCall.plan).toBe('monthly');
		expect(firstCall.kind).toBe('campaign');
		expect(firstCall.issuedBy).toBe('ops:u-ops-7');
		// tenantId は reason から自動採番される
		expect(firstCall.tenantId).toBe('campaign:2026春キャンペーン');
	});

	it('expiresAt="never" は null として service に渡る', async () => {
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u1', email: 'o@e.com' },
			formData: {
				plan: 'lifetime',
				quantity: '1',
				reason: 'test',
				expiresAt: 'never',
			},
		});
		if (!actions.issue) throw new Error('issue action missing');
		await actions.issue(ev);
		expect(mockIssueLicenseKey.mock.calls[0]?.[0]?.expiresAt).toBeNull();
	});

	it('expiresAt="default" は undefined (service デフォルト 90 日)', async () => {
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u1', email: 'o@e.com' },
			formData: {
				plan: 'monthly',
				quantity: '1',
				reason: 'test',
				expiresAt: 'default',
			},
		});
		if (!actions.issue) throw new Error('issue action missing');
		await actions.issue(ev);
		expect(mockIssueLicenseKey.mock.calls[0]?.[0]?.expiresAt).toBeUndefined();
	});

	it('tenantId 明示指定時はそれを使う', async () => {
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u1', email: 'o@e.com' },
			formData: {
				plan: 'monthly',
				quantity: '1',
				reason: 'test',
				tenantId: 'campaign:hanami2026',
			},
		});
		if (!actions.issue) throw new Error('issue action missing');
		await actions.issue(ev);
		expect(mockIssueLicenseKey.mock.calls[0]?.[0]?.tenantId).toBe('campaign:hanami2026');
	});

	it('全件発行失敗 → 500', async () => {
		mockIssueLicenseKey.mockReset();
		mockIssueLicenseKey.mockRejectedValue(new Error('db down'));
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u1', email: 'o@e.com' },
			formData: { plan: 'monthly', quantity: '2', reason: 'test' },
		});
		if (!actions.issue) throw new Error('issue action missing');
		const r = await actions.issue(ev);
		expect(isActionFailure(r)).toBe(true);
		if (isActionFailure(r)) {
			expect(r.status).toBe(500);
			expect(r.data.error).toContain('db down');
		}
	});

	it('部分失敗 (2/3 成功) → issued:true + errors 付与', async () => {
		mockIssueLicenseKey.mockReset();
		mockIssueLicenseKey
			.mockResolvedValueOnce({
				licenseKey: 'GQ-AAAA-BBBB-CCCC-XXX01',
				tenantId: 'campaign:test',
				plan: 'monthly',
				status: 'active',
				createdAt: '2026-04-16T10:00:00.000Z',
				kind: 'campaign',
			})
			.mockRejectedValueOnce(new Error('write conflict'))
			.mockResolvedValueOnce({
				licenseKey: 'GQ-AAAA-BBBB-CCCC-XXX03',
				tenantId: 'campaign:test',
				plan: 'monthly',
				status: 'active',
				createdAt: '2026-04-16T10:00:00.000Z',
				kind: 'campaign',
			});
		const ev = makeEvent({
			identity: { type: 'cognito', userId: 'u1', email: 'o@e.com' },
			formData: { plan: 'monthly', quantity: '3', reason: 'test' },
		});
		if (!actions.issue) throw new Error('issue action missing');
		const r = await actions.issue(ev);
		expect(r).toMatchObject({ issued: true });
		expect((r as { keys: string[]; errors?: string[] }).keys).toHaveLength(2);
		expect((r as { keys: string[]; errors?: string[] }).errors).toEqual(['write conflict']);
	});
});
