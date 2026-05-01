// tests/unit/routes/account-delete-api.test.ts
// #1781: /api/v1/admin/account/delete のプラン別ディスパッチ検証
//
// 期待動作:
//   - free プラン (licenseStatus=none) → softDeleteTenant が requiresImmediateDeletion=true を返し、
//     deleteOwnerOnlyAccount / deleteOwnerFullDelete が呼ばれる
//   - standard プラン → softDeleteTenant のみで物理削除関数は呼ばれない、cancelSubscription が呼ばれる
//   - family プラン → 同上

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSoftDelete = vi.fn();
const mockDeleteOwnerOnly = vi.fn();
const mockDeleteOwnerFull = vi.fn();
const mockCancelSubscription = vi.fn();

vi.mock('$lib/server/services/grace-period-service', () => ({
	softDeleteTenant: mockSoftDelete,
}));

vi.mock('$lib/server/services/account-deletion-service', () => ({
	deleteOwnerOnlyAccount: mockDeleteOwnerOnly,
	deleteOwnerFullDelete: mockDeleteOwnerFull,
	deleteChildAccount: vi.fn(),
	deleteMemberAccount: vi.fn(),
	transferOwnershipAndLeave: vi.fn(),
}));

vi.mock('$lib/server/services/stripe-service', () => ({
	cancelSubscription: mockCancelSubscription,
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { POST } = await import('../../../src/routes/api/v1/admin/account/delete/+server');

function makeEvent(opts: {
	pattern: string;
	plan?: string;
	licenseStatus?: string;
	role?: 'owner' | 'parent' | 'child';
	tenantId?: string;
}) {
	const body = JSON.stringify({ pattern: opts.pattern });
	const request = new Request('http://localhost/api/v1/admin/account/delete', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
	});
	return {
		request,
		locals: {
			context: {
				tenantId: opts.tenantId ?? 'tenant-1781',
				role: opts.role ?? 'owner',
				licenseStatus: opts.licenseStatus ?? 'none',
				plan: opts.plan,
			},
			identity: { type: 'cognito' as const, userId: 'user-1', email: 'a@b' },
		},
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/v1/admin/account/delete (#1781 プラン別グレースピリオド)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('owner-only パターン', () => {
		it('free プラン: softDeleteTenant が即時削除を要求 → deleteOwnerOnlyAccount を呼ぶ', async () => {
			mockSoftDelete.mockResolvedValue({
				success: true,
				softDeletedAt: '2026-05-01T00:00:00.000Z',
				gracePeriodDays: 0,
				physicalDeletionDate: '2026-05-01T00:00:00.000Z',
				requiresImmediateDeletion: true,
			});
			mockDeleteOwnerOnly.mockResolvedValue({
				success: true,
				pattern: 'owner-only',
				itemsDeleted: 5,
				filesDeleted: 1,
				unaffiliatedMembers: [],
			});

			const res = await POST(makeEvent({ pattern: 'owner-only', licenseStatus: 'none' }));

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.softDeleted).toBe(false);
			expect(mockSoftDelete).toHaveBeenCalledWith('tenant-1781', 'none', undefined);
			expect(mockDeleteOwnerOnly).toHaveBeenCalledWith('tenant-1781', 'user-1');
			expect(mockCancelSubscription).not.toHaveBeenCalled();
		});

		it('standard プラン: soft-delete + Stripe キャンセル、物理削除は呼ばない', async () => {
			mockSoftDelete.mockResolvedValue({
				success: true,
				softDeletedAt: '2026-05-01T00:00:00.000Z',
				gracePeriodDays: 7,
				physicalDeletionDate: '2026-05-08T00:00:00.000Z',
				requiresImmediateDeletion: false,
			});
			mockCancelSubscription.mockResolvedValue({ ok: true });

			const res = await POST(
				makeEvent({ pattern: 'owner-only', licenseStatus: 'active', plan: 'monthly' }),
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.softDeleted).toBe(true);
			expect(body.gracePeriodDays).toBe(7);
			expect(body.physicalDeletionDate).toBe('2026-05-08T00:00:00.000Z');
			expect(mockSoftDelete).toHaveBeenCalledWith('tenant-1781', 'active', 'monthly');
			expect(mockCancelSubscription).toHaveBeenCalledWith('tenant-1781');
			expect(mockDeleteOwnerOnly).not.toHaveBeenCalled();
		});

		it('family プラン: soft-delete + Stripe キャンセル (30 日)、物理削除は呼ばない', async () => {
			mockSoftDelete.mockResolvedValue({
				success: true,
				softDeletedAt: '2026-05-01T00:00:00.000Z',
				gracePeriodDays: 30,
				physicalDeletionDate: '2026-05-31T00:00:00.000Z',
				requiresImmediateDeletion: false,
			});
			mockCancelSubscription.mockResolvedValue({ ok: true });

			const res = await POST(
				makeEvent({ pattern: 'owner-only', licenseStatus: 'active', plan: 'family-monthly' }),
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.softDeleted).toBe(true);
			expect(body.gracePeriodDays).toBe(30);
			expect(mockCancelSubscription).toHaveBeenCalledWith('tenant-1781');
			expect(mockDeleteOwnerOnly).not.toHaveBeenCalled();
		});

		it('owner 以外は 403', async () => {
			const res = await POST(makeEvent({ pattern: 'owner-only', role: 'parent' }));
			expect(res.status).toBe(403);
			expect(mockSoftDelete).not.toHaveBeenCalled();
		});
	});

	describe('owner-full-delete パターン', () => {
		it('free プラン: 即時 deleteOwnerFullDelete を呼ぶ', async () => {
			mockSoftDelete.mockResolvedValue({
				success: true,
				softDeletedAt: '2026-05-01T00:00:00.000Z',
				gracePeriodDays: 0,
				physicalDeletionDate: '2026-05-01T00:00:00.000Z',
				requiresImmediateDeletion: true,
			});
			mockDeleteOwnerFull.mockResolvedValue({
				success: true,
				pattern: 'owner-full-delete',
				itemsDeleted: 10,
				filesDeleted: 2,
				unaffiliatedMembers: ['user-2'],
			});

			const res = await POST(makeEvent({ pattern: 'owner-full-delete', licenseStatus: 'none' }));

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.softDeleted).toBe(false);
			expect(mockDeleteOwnerFull).toHaveBeenCalledWith('tenant-1781', 'user-1');
		});

		it('family プラン: soft-delete + Stripe キャンセル、物理削除は cron 待ち', async () => {
			mockSoftDelete.mockResolvedValue({
				success: true,
				softDeletedAt: '2026-05-01T00:00:00.000Z',
				gracePeriodDays: 30,
				physicalDeletionDate: '2026-05-31T00:00:00.000Z',
				requiresImmediateDeletion: false,
			});
			mockCancelSubscription.mockResolvedValue({ ok: true });

			const res = await POST(
				makeEvent({
					pattern: 'owner-full-delete',
					licenseStatus: 'active',
					plan: 'family-monthly',
				}),
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.softDeleted).toBe(true);
			expect(body.gracePeriodDays).toBe(30);
			expect(mockCancelSubscription).toHaveBeenCalledWith('tenant-1781');
			expect(mockDeleteOwnerFull).not.toHaveBeenCalled();
		});
	});

	describe('バリデーション', () => {
		it('未認証は 401', async () => {
			const event = {
				request: new Request('http://localhost/api/v1/admin/account/delete', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ pattern: 'owner-only' }),
				}),
				locals: { context: null, identity: null },
			} as unknown as Parameters<typeof POST>[0];
			const res = await POST(event);
			expect(res.status).toBe(401);
		});

		it('pattern なしは 400', async () => {
			const event = {
				request: new Request('http://localhost/api/v1/admin/account/delete', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
				locals: {
					context: { tenantId: 't', role: 'owner', licenseStatus: 'none' },
					identity: { type: 'cognito', userId: 'u', email: 'a@b' },
				},
			} as unknown as Parameters<typeof POST>[0];
			const res = await POST(event);
			expect(res.status).toBe(400);
		});
	});
});
