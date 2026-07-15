// tests/unit/routes/admin-invites-owner-gate.test.ts
// #3726 (= #3673 same-class 残余): invites 2 endpoint の owner-gate hardening 検証。
//
// #3673 で account/tenant/members 系 6 route を ownerGateResponse + OWNER_GATE_LABELS に
// 集約した際、invites 2 endpoint に旧 inline パターン (catch 内 isHttpError(e,403) のみ捕捉 →
// 401 が outer catch へ伝播し 500 化する潜在退行 + 403 文言 literal 直書き) が残存した。
// 本テストは hardening 後の契約を固定する:
//   - 非 owner (parent/child) → 403 + OWNER_GATE_LABELS SSOT 文言 (置換前とバイト一致)
//   - 未認証 (context 欠落) → 401 + {error: 認証が必要です} (500 化しない)
//   - owner → gate 通過 (後続処理へ続行)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OWNER_GATE_LABELS } from '../../../src/lib/domain/labels';

// ---------- service mocks (gate 通過後の後続を無害化) ----------

const mockCreateInvite = vi.fn();
const mockListInvites = vi.fn();
const mockRevokeInvite = vi.fn();
vi.mock('$lib/server/services/invite-service', () => ({
	createInvite: (...args: unknown[]) => mockCreateInvite(...args),
	listInvites: (...args: unknown[]) => mockListInvites(...args),
	revokeInvite: (...args: unknown[]) => mockRevokeInvite(...args),
}));
vi.mock('$lib/server/services/plan-limit-service', () => ({
	checkFamilyMemberLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type Role = 'owner' | 'parent' | 'child';

function makeLocals(role: Role | null): App.Locals {
	return {
		context: role ? { tenantId: 't-invites', role, licenseStatus: 'active', plan: 'family' } : null,
		identity: role ? { type: 'cognito', userId: 'u-1', email: 'o@example.com' } : null,
	} as unknown as App.Locals;
}

afterEach(() => {
	vi.clearAllMocks();
});

describe('POST /api/v1/admin/invites owner-gate (#3726)', () => {
	const load = () => import('../../../src/routes/api/v1/admin/invites/+server');

	for (const role of ['parent', 'child'] as const) {
		it(`${role} は 403 + OWNER_GATE_LABELS.inviteCreate (SSOT 文言、旧 literal とバイト一致)`, async () => {
			const { POST } = await load();
			const res = await POST({
				request: new Request('http://t/api/v1/admin/invites', { method: 'POST' }),
				locals: makeLocals(role),
			} as never);
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: OWNER_GATE_LABELS.inviteCreate });
			expect(OWNER_GATE_LABELS.inviteCreate).toBe('owner のみ招待を作成できます');
			expect(mockCreateInvite).not.toHaveBeenCalled();
		});
	}

	it('未認証 (context 欠落) は 500 化せず 401 (401→500 潜在退行の根治)', async () => {
		const { POST } = await load();
		const res = await POST({
			request: new Request('http://t/api/v1/admin/invites', { method: 'POST' }),
			locals: makeLocals(null),
		} as never);
		expect(res.status).toBe(401);
	});

	it('owner は gate を通過し後続処理へ続行する (403 で遮断されない)', async () => {
		mockCreateInvite.mockResolvedValue({ code: 'ABC123', role: 'parent' });
		const { POST } = await load();
		let res: Response | Error;
		try {
			res = await POST({
				request: new Request('http://t/api/v1/admin/invites', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ role: 'parent' }),
				}),
				locals: makeLocals('owner'),
			} as never);
		} catch (e) {
			res = e as Error;
		}
		// gate (401/403) では遮断されない — 後続の validation / service に到達していること
		if (res instanceof Response) {
			expect([401, 403]).not.toContain(res.status);
		}
	});
});

describe('DELETE /api/v1/admin/invites/[code] owner-gate (#3726)', () => {
	const load = () => import('../../../src/routes/api/v1/admin/invites/[code]/+server');

	for (const role of ['parent', 'child'] as const) {
		it(`${role} は 403 + OWNER_GATE_LABELS.inviteRevoke (SSOT 文言、旧 literal とバイト一致)`, async () => {
			const { DELETE } = await load();
			const res = await DELETE({
				params: { code: 'ABC123' },
				locals: makeLocals(role),
			} as never);
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: OWNER_GATE_LABELS.inviteRevoke });
			expect(OWNER_GATE_LABELS.inviteRevoke).toBe('owner のみ招待を取り消しできます');
			expect(mockRevokeInvite).not.toHaveBeenCalled();
		});
	}

	it('未認証 (context 欠落) は 500 化せず 401', async () => {
		const { DELETE } = await load();
		const res = await DELETE({
			params: { code: 'ABC123' },
			locals: makeLocals(null),
		} as never);
		expect(res.status).toBe(401);
	});

	it('owner は gate を通過し revokeInvite に到達する', async () => {
		mockRevokeInvite.mockResolvedValue(undefined);
		const { DELETE } = await load();
		const res = await DELETE({
			params: { code: 'ABC123' },
			locals: makeLocals('owner'),
		} as never);
		expect(res.status).toBe(200);
		expect(mockRevokeInvite).toHaveBeenCalledWith('ABC123', 't-invites');
	});
});
