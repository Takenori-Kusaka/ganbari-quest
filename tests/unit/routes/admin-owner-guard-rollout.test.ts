// tests/unit/routes/admin-owner-guard-rollout.test.ts
// #3556 (behavior-preserving): owner-only ad-hoc role 判定の残存 4 route
// (tenant/cancel / tenant/reactivate / account/deletion-info / account/delete 3 pattern)
// を requireRole seam (src/lib/server/auth/guards.ts) に統一する回帰テスト。
// admin-role-mutation-authz.test.ts (#3528 fitness#3) と同方式だが、
// account/tenant 系は mock 構成 (stripe / grace-period / account-deletion service)
// が大きく異なるため別 file とする。
//
// テスト観点:
// - 各 route が requireRole(locals, ['owner']) seam を経由して判定していること
//   (red: 現実装はインライン context.role !== 'owner' 判定で requireRole を呼ばない
//   ため seam spy assertion が fail する)
// - negative (parent / child): 403 + 既存 `{ error: <既存日本語文言> }` body が
//   バイト一致で維持されること (回帰固定: 現実装でも green)
// - positive (owner): 成功経路に入ること (回帰固定: 現実装でも green)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mocks ----------

// requireRole seam の spy: 実装 (throw error(401/403)) はそのまま使い、呼び出しを観測する
const requireRoleSpy = vi.fn();
vi.mock('$lib/server/auth/guards', async () => {
	const actual =
		await vi.importActual<typeof import('../../../src/lib/server/auth/guards')>(
			'$lib/server/auth/guards',
		);
	return {
		...actual,
		requireRole: (...args: Parameters<typeof actual.requireRole>) => {
			requireRoleSpy(...args);
			return actual.requireRole(...args);
		},
	};
});

const mockRepos = {
	auth: {
		findTenantById: vi.fn(),
		updateTenantStripe: vi.fn(),
	},
};
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => mockRepos,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockCancelSubscription = vi.fn();
vi.mock('$lib/server/services/stripe-service', () => ({
	cancelSubscription: (...args: unknown[]) => mockCancelSubscription(...args),
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyCancellation: vi.fn().mockResolvedValue(undefined),
	notifyCancellationReverted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/services/email-service', () => ({
	sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
}));

const mockDeleteOwnerOnlyAccount = vi.fn();
const mockDeleteOwnerFullDelete = vi.fn();
const mockTransferOwnershipAndLeave = vi.fn();
const mockGetOwnerDeletionInfo = vi.fn();
vi.mock('$lib/server/services/account-deletion-service', () => ({
	deleteChildAccount: vi.fn(),
	deleteMemberAccount: vi.fn(),
	deleteOwnerFullDelete: (...args: unknown[]) => mockDeleteOwnerFullDelete(...args),
	deleteOwnerOnlyAccount: (...args: unknown[]) => mockDeleteOwnerOnlyAccount(...args),
	transferOwnershipAndLeave: (...args: unknown[]) => mockTransferOwnershipAndLeave(...args),
	getOwnerDeletionInfo: (...args: unknown[]) => mockGetOwnerDeletionInfo(...args),
}));

const mockSoftDeleteTenant = vi.fn();
vi.mock('$lib/server/services/grace-period-service', () => ({
	DELETION_GRACE_PERIOD_DAYS: { free: 0, standard: 7, premium: 30, family: 30 },
	softDeleteTenant: (...args: unknown[]) => mockSoftDeleteTenant(...args),
}));

const mockResolveFullPlanTier = vi.fn();
vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
}));

const { POST: tenantCancel } = await import(
	'../../../src/routes/api/v1/admin/tenant/cancel/+server'
);
const { POST: tenantReactivate } = await import(
	'../../../src/routes/api/v1/admin/tenant/reactivate/+server'
);
const { GET: deletionInfo } = await import(
	'../../../src/routes/api/v1/admin/account/deletion-info/+server'
);
const { POST: accountDelete } = await import(
	'../../../src/routes/api/v1/admin/account/delete/+server'
);

// ---------- helpers ----------

type Role = 'owner' | 'parent' | 'child';

function createLocals(role: Role) {
	return {
		context: { tenantId: 't-test', role, plan: 'free', licenseStatus: 'none' },
		identity: { type: 'cognito', userId: 'u-caller', email: 'caller@example.com' },
	};
}

function createSimpleEvent(role: Role) {
	return { locals: createLocals(role) } as unknown as Parameters<
		NonNullable<typeof tenantCancel>
	>[0];
}

function createDeleteEvent(role: Role, pattern: string, extra: Record<string, unknown> = {}) {
	return {
		request: new Request('http://localhost/api/v1/admin/account/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pattern, ...extra }),
		}),
		locals: createLocals(role),
	} as unknown as Parameters<NonNullable<typeof accountDelete>>[0];
}

function expectSeamCalledWith(role: Role) {
	expect(requireRoleSpy).toHaveBeenCalledWith(
		expect.objectContaining({ context: expect.objectContaining({ role }) }),
		['owner'],
	);
}

// ---------- tests ----------

describe('owner-only ad-hoc guard 残存 route の requireRole seam 統一 (#3556)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRepos.auth.findTenantById.mockResolvedValue({
			status: 'active',
			stripeSubscriptionId: 'sub_1',
		});
		mockRepos.auth.updateTenantStripe.mockResolvedValue(undefined);
		mockCancelSubscription.mockResolvedValue({ status: 'canceled' });
		mockResolveFullPlanTier.mockResolvedValue('free');
		mockDeleteOwnerOnlyAccount.mockResolvedValue({ success: true, pattern: 'owner-only' });
		mockDeleteOwnerFullDelete.mockResolvedValue({ success: true, pattern: 'owner-full-delete' });
		mockTransferOwnershipAndLeave.mockResolvedValue({
			success: true,
			pattern: 'owner-with-transfer',
		});
		mockGetOwnerDeletionInfo.mockResolvedValue({ members: [], transferCandidates: [] });
	});

	describe('POST /api/v1/admin/tenant/cancel', () => {
		it('owner は成功経路に入る (positive、回帰固定)', async () => {
			const res = await tenantCancel(createSimpleEvent('owner'));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toMatchObject({ success: true });
			expect(mockCancelSubscription).toHaveBeenCalledWith('t-test');
		});

		it('owner 判定は requireRole seam 経由で行われる (red → green)', async () => {
			await tenantCancel(createSimpleEvent('owner'));
			expectSeamCalledWith('owner');
		});

		it('parent は 403 + 既存 {error} body バイト一致 (negative、回帰固定)', async () => {
			const res = await tenantCancel(createSimpleEvent('parent'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ解約申請できます' });
			expect(mockCancelSubscription).not.toHaveBeenCalled();
			expect(mockRepos.auth.updateTenantStripe).not.toHaveBeenCalled();
		});

		it('child は 403 (negative)', async () => {
			const res = await tenantCancel(createSimpleEvent('child'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ解約申請できます' });
			expect(mockCancelSubscription).not.toHaveBeenCalled();
		});
	});

	describe('POST /api/v1/admin/tenant/reactivate', () => {
		beforeEach(() => {
			mockRepos.auth.findTenantById.mockResolvedValue({
				status: 'grace_period',
				stripeSubscriptionId: 'sub_1',
			});
		});

		it('owner は成功経路に入る (positive、回帰固定)', async () => {
			const res = await tenantReactivate(createSimpleEvent('owner'));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({ success: true });
			expect(mockRepos.auth.updateTenantStripe).toHaveBeenCalled();
		});

		it('owner 判定は requireRole seam 経由で行われる (red → green)', async () => {
			await tenantReactivate(createSimpleEvent('owner'));
			expectSeamCalledWith('owner');
		});

		it('parent は 403 + 既存 {error} body バイト一致 (negative、回帰固定)', async () => {
			const res = await tenantReactivate(createSimpleEvent('parent'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ解約キャンセルできます' });
			expect(mockRepos.auth.updateTenantStripe).not.toHaveBeenCalled();
		});

		it('child は 403 (negative)', async () => {
			const res = await tenantReactivate(createSimpleEvent('child'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ解約キャンセルできます' });
			expect(mockRepos.auth.updateTenantStripe).not.toHaveBeenCalled();
		});
	});

	describe('GET /api/v1/admin/account/deletion-info', () => {
		it('owner は成功経路に入る (positive、回帰固定)', async () => {
			const res = await deletionInfo(createSimpleEvent('owner'));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({ members: [], transferCandidates: [] });
			expect(mockGetOwnerDeletionInfo).toHaveBeenCalledWith('t-test', 'u-caller');
		});

		it('owner 判定は requireRole seam 経由で行われる (red → green)', async () => {
			await deletionInfo(createSimpleEvent('owner'));
			expectSeamCalledWith('owner');
		});

		it('parent は 403 + 既存 {error} body バイト一致 (negative、回帰固定)', async () => {
			const res = await deletionInfo(createSimpleEvent('parent'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ取得できます' });
			expect(mockGetOwnerDeletionInfo).not.toHaveBeenCalled();
		});

		it('child は 403 (negative)', async () => {
			const res = await deletionInfo(createSimpleEvent('child'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ取得できます' });
			expect(mockGetOwnerDeletionInfo).not.toHaveBeenCalled();
		});
	});

	describe('POST /api/v1/admin/account/delete (owner 系 3 pattern)', () => {
		for (const pattern of ['owner-only', 'owner-with-transfer', 'owner-full-delete'] as const) {
			describe(`pattern=${pattern}`, () => {
				const extra = pattern === 'owner-with-transfer' ? { newOwnerId: 'u-next' } : {};

				it('owner は成功経路に入る (positive、回帰固定)', async () => {
					const res = await accountDelete(createDeleteEvent('owner', pattern, extra));
					expect(res.status).toBe(200);
					await expect(res.json()).resolves.toMatchObject({ success: true });
				});

				it('owner 判定は requireRole seam 経由で行われる (red → green)', async () => {
					await accountDelete(createDeleteEvent('owner', pattern, extra));
					expectSeamCalledWith('owner');
				});

				it('parent は 403 + 既存 {error} body バイト一致 (negative、回帰固定)', async () => {
					const res = await accountDelete(createDeleteEvent('parent', pattern, extra));
					expect(res.status).toBe(403);
					await expect(res.json()).resolves.toEqual({ error: 'owner のみ実行できます' });
					expect(mockDeleteOwnerOnlyAccount).not.toHaveBeenCalled();
					expect(mockDeleteOwnerFullDelete).not.toHaveBeenCalled();
					expect(mockTransferOwnershipAndLeave).not.toHaveBeenCalled();
				});

				it('child は 403 (negative)', async () => {
					const res = await accountDelete(createDeleteEvent('child', pattern, extra));
					expect(res.status).toBe(403);
					await expect(res.json()).resolves.toEqual({ error: 'owner のみ実行できます' });
					expect(mockDeleteOwnerOnlyAccount).not.toHaveBeenCalled();
					expect(mockDeleteOwnerFullDelete).not.toHaveBeenCalled();
					expect(mockTransferOwnershipAndLeave).not.toHaveBeenCalled();
				});
			});
		}
	});
});
