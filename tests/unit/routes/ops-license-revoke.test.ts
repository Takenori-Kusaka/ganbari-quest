// tests/unit/routes/ops-license-revoke.test.ts
// #805: /ops/license/[key] の revoke form action 契約テスト。
//
// テスト観点:
// - ops 非認証 (local identity / null) は 403
// - 不正な reason は 400
// - service が { ok: false } を返すと 409 + error メッセージ
// - service が { ok: true } を返すと revoked: true を返す
// - actorId が `ops:<userId>` 形式で service に渡る

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevokeLicenseKey = vi.fn();
const mockFindLicenseKey = vi.fn();

vi.mock('$lib/server/services/license-key-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/license-key-service')>(
		'$lib/server/services/license-key-service',
	);
	return {
		...actual,
		revokeLicenseKey: (...args: unknown[]) => mockRevokeLicenseKey(...args),
	};
});

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findLicenseKey: mockFindLicenseKey,
		},
	}),
}));

const { actions, load } = await import('../../../src/routes/ops/license/[key]/+page.server');

type LocalsShape = {
	identity: { type: 'local' } | { type: 'cognito'; userId: string; email: string } | null;
};

function makeEvent(opts: {
	licenseKey: string;
	identity: LocalsShape['identity'];
	formData?: Record<string, string>;
	ip?: string;
	ua?: string | null;
}) {
	const form = new FormData();
	for (const [k, v] of Object.entries(opts.formData ?? {})) {
		form.set(k, v);
	}
	return {
		params: { key: opts.licenseKey },
		locals: { identity: opts.identity },
		request: {
			formData: async () => form,
			headers: {
				get: (h: string) => (h.toLowerCase() === 'user-agent' ? (opts.ua ?? null) : null),
			},
		},
		getClientAddress: () => opts.ip ?? '203.0.113.7',
	} as unknown as Parameters<NonNullable<typeof actions.revoke>>[0];
}

function isHttpError(e: unknown): e is { status: number } {
	return typeof e === 'object' && e !== null && 'status' in e;
}

function isActionFailure(v: unknown): v is { status: number; data: { error?: string } } {
	return typeof v === 'object' && v !== null && 'status' in v && 'data' in v;
}

describe('#805 /ops/license/[key]/+page.server.ts revoke action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('識別情報が null の場合は 403 (念のためのガード)', async () => {
		const ev = makeEvent({
			licenseKey: 'GQ-AAAA-BBBB-CCCC-XXX01',
			identity: null,
			formData: { reason: 'ops-manual' },
		});
		try {
			if (!actions.revoke) throw new Error('revoke action missing');
			await actions.revoke(ev);
			expect.fail('403 がスローされるはず');
		} catch (e) {
			if (!isHttpError(e)) throw e;
			expect(e.status).toBe(403);
		}
		expect(mockRevokeLicenseKey).not.toHaveBeenCalled();
	});

	it('local identity は 403', async () => {
		const ev = makeEvent({
			licenseKey: 'GQ-AAAA-BBBB-CCCC-XXX02',
			identity: { type: 'local' },
			formData: { reason: 'ops-manual' },
		});
		try {
			if (!actions.revoke) throw new Error('revoke action missing');
			await actions.revoke(ev);
			expect.fail('403 がスローされるはず');
		} catch (e) {
			if (!isHttpError(e)) throw e;
			expect(e.status).toBe(403);
		}
	});

	it('不正な reason は 400', async () => {
		const ev = makeEvent({
			licenseKey: 'GQ-AAAA-BBBB-CCCC-XXX03',
			identity: { type: 'cognito', userId: 'u-ops', email: 'ops@example.com' },
			formData: { reason: 'hacker' },
		});
		if (!actions.revoke) throw new Error('revoke action missing');
		const result = await actions.revoke(ev);
		expect(isActionFailure(result)).toBe(true);
		if (isActionFailure(result)) {
			expect(result.status).toBe(400);
		}
		expect(mockRevokeLicenseKey).not.toHaveBeenCalled();
	});

	it('service が ok:false を返すと 409 + error メッセージ', async () => {
		mockRevokeLicenseKey.mockResolvedValueOnce({
			ok: false,
			reason: 'このライセンスキーは既に無効化されています',
		});
		const ev = makeEvent({
			licenseKey: 'GQ-AAAA-BBBB-CCCC-XXX04',
			identity: { type: 'cognito', userId: 'u-ops', email: 'ops@example.com' },
			formData: { reason: 'ops-manual', note: 'CS-123' },
		});
		if (!actions.revoke) throw new Error('revoke action missing');
		const result = await actions.revoke(ev);
		expect(isActionFailure(result)).toBe(true);
		if (isActionFailure(result)) {
			expect(result.status).toBe(409);
			expect(result.data.error).toContain('既に無効化');
		}
	});

	it('ok:true を返すと revoked: true を返す', async () => {
		mockRevokeLicenseKey.mockResolvedValueOnce({
			ok: true,
			licenseKey: 'GQ-AAAA-BBBB-CCCC-XXX05',
			revokedReason: 'ops-manual',
			revokedAt: '2026-04-16T10:00:00.000Z',
		});
		const ev = makeEvent({
			licenseKey: 'GQ-AAAA-BBBB-CCCC-XXX05',
			identity: { type: 'cognito', userId: 'u-ops-42', email: 'ops@example.com' },
			formData: { reason: 'refund', note: 'Stripe dispute #abc' },
			ip: '198.51.100.55',
			ua: 'ops-browser/1.0',
		});
		if (!actions.revoke) throw new Error('revoke action missing');
		const result = await actions.revoke(ev);
		expect(result).toMatchObject({ revoked: true, reason: 'refund' });

		expect(mockRevokeLicenseKey).toHaveBeenCalledTimes(1);
		const arg = mockRevokeLicenseKey.mock.calls[0]?.[0]!;
		expect(arg.licenseKey).toBe('GQ-AAAA-BBBB-CCCC-XXX05');
		expect(arg.reason).toBe('refund');
		expect(arg.revokedBy).toBe('ops:u-ops-42');
	});

	it('キーは URL decode + upper-case に正規化される', async () => {
		mockRevokeLicenseKey.mockResolvedValueOnce({
			ok: true,
			licenseKey: 'GQ-LOWER-CASE-KEY-XXX06',
			revokedReason: 'ops-manual',
			revokedAt: '2026-04-16T10:00:00.000Z',
		});
		const ev = makeEvent({
			licenseKey: 'gq-lower-case-key-xxx06',
			identity: { type: 'cognito', userId: 'u-ops', email: 'ops@example.com' },
			formData: { reason: 'ops-manual' },
		});
		if (!actions.revoke) throw new Error('revoke action missing');
		await actions.revoke(ev);
		const arg = mockRevokeLicenseKey.mock.calls[0]?.[0]!;
		expect(arg.licenseKey).toBe('GQ-LOWER-CASE-KEY-XXX06');
	});
});

describe('#805 /ops/license/[key]/+page.server.ts load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('record 未存在でも画面表示できる (record=null)', async () => {
		mockFindLicenseKey.mockResolvedValueOnce(undefined);
		const result = (await load({
			params: { key: 'gq-miss' },
		} as unknown as Parameters<typeof load>[0])) as {
			record: unknown;
			licenseKey: string;
		};
		expect(result.record).toBeNull();
		expect(result.licenseKey).toBe('GQ-MISS');
	});

	it('record が存在する場合は record を返す', async () => {
		mockFindLicenseKey.mockResolvedValueOnce({
			licenseKey: 'GQ-HIT-KEY',
			tenantId: 't-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-03-01T00:00:00Z',
		});
		const result = (await load({
			params: { key: 'gq-hit-key' },
		} as unknown as Parameters<typeof load>[0])) as {
			record: { licenseKey: string; status: string };
		};
		expect(result.record).toMatchObject({ licenseKey: 'GQ-HIT-KEY', status: 'active' });
	});
});
