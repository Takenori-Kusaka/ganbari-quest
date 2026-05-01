// tests/unit/routes/account-delete-api.test.ts
// #1781: /api/v1/admin/account/delete のプラン別ディスパッチ検証
//
// 期待動作:
//   - free プラン (planTier=free, graceDays=0) → 即時 deleteOwnerOnlyAccount / deleteOwnerFullDelete を呼ぶ
//   - standard プラン (planTier=standard, graceDays=7) → cancelSubscription → softDeleteTenant の順で実行
//   - family プラン (planTier=family, graceDays=30) → 同上
//
// #1811 Re-Review: トランザクション順序の整合性検証を追加。
//   - cancelSubscription が softDeleteTenant より先に呼ばれることを検証
//   - cancelSubscription が throw した場合に softDeleteTenant が呼ばれないことを検証

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveFullPlanTier = vi.fn();
const mockSoftDelete = vi.fn();
const mockDeleteOwnerOnly = vi.fn();
const mockDeleteOwnerFull = vi.fn();
const mockCancelSubscription = vi.fn();

vi.mock('$lib/server/services/grace-period-service', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		// DELETION_GRACE_PERIOD_DAYS は実値を使う ({ free: 0, standard: 7, family: 30 })
		softDeleteTenant: mockSoftDelete,
	};
});

vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: mockResolveFullPlanTier,
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
		it('free プラン: graceDays=0 → 即時 deleteOwnerOnlyAccount を呼ぶ', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
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
			expect(mockResolveFullPlanTier).toHaveBeenCalledWith('tenant-1781', 'none', undefined);
			expect(mockDeleteOwnerOnly).toHaveBeenCalledWith('tenant-1781', 'user-1');
			// free 経路では soft-delete 記録 / 直接 Stripe キャンセルは呼ばない
			// (Stripe キャンセルは deleteOwnerOnlyAccount 内部で行われる)
			expect(mockSoftDelete).not.toHaveBeenCalled();
			expect(mockCancelSubscription).not.toHaveBeenCalled();
		});

		it('standard プラン: cancelSubscription → softDeleteTenant の順で実行、物理削除は呼ばない', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockCancelSubscription.mockResolvedValue({ ok: true });
			mockSoftDelete.mockResolvedValue({
				success: true,
				softDeletedAt: '2026-05-01T00:00:00.000Z',
				gracePeriodDays: 7,
				physicalDeletionDate: '2026-05-08T00:00:00.000Z',
				requiresImmediateDeletion: false,
			});

			const res = await POST(
				makeEvent({ pattern: 'owner-only', licenseStatus: 'active', plan: 'monthly' }),
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.softDeleted).toBe(true);
			expect(body.gracePeriodDays).toBe(7);
			expect(body.physicalDeletionDate).toBe('2026-05-08T00:00:00.000Z');
			expect(mockCancelSubscription).toHaveBeenCalledWith('tenant-1781');
			expect(mockSoftDelete).toHaveBeenCalledWith('tenant-1781', 'active', 'monthly');
			expect(mockDeleteOwnerOnly).not.toHaveBeenCalled();
			// #1811: 順序検証 — cancelSubscription が softDeleteTenant より先に呼ばれる
			const cancelOrder = mockCancelSubscription.mock.invocationCallOrder[0] ?? -1;
			const softDeleteOrder = mockSoftDelete.mock.invocationCallOrder[0] ?? -1;
			expect(cancelOrder).toBeGreaterThan(0);
			expect(softDeleteOrder).toBeGreaterThan(0);
			expect(cancelOrder).toBeLessThan(softDeleteOrder);
		});

		it('family プラン: cancelSubscription → softDeleteTenant の順 (30 日)、物理削除は呼ばない', async () => {
			mockResolveFullPlanTier.mockResolvedValue('family');
			mockCancelSubscription.mockResolvedValue({ ok: true });
			mockSoftDelete.mockResolvedValue({
				success: true,
				softDeletedAt: '2026-05-01T00:00:00.000Z',
				gracePeriodDays: 30,
				physicalDeletionDate: '2026-05-31T00:00:00.000Z',
				requiresImmediateDeletion: false,
			});

			const res = await POST(
				makeEvent({ pattern: 'owner-only', licenseStatus: 'active', plan: 'family-monthly' }),
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.softDeleted).toBe(true);
			expect(body.gracePeriodDays).toBe(30);
			expect(mockCancelSubscription).toHaveBeenCalledWith('tenant-1781');
			expect(mockSoftDelete).toHaveBeenCalled();
			expect(mockDeleteOwnerOnly).not.toHaveBeenCalled();
		});

		it('#1811: standard プラン Stripe 失敗時は softDeleteTenant を呼ばず 500 を返す', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockCancelSubscription.mockRejectedValue(new Error('Stripe API down'));

			const res = await POST(
				makeEvent({ pattern: 'owner-only', licenseStatus: 'active', plan: 'monthly' }),
			);

			expect(res.status).toBe(500);
			expect(mockCancelSubscription).toHaveBeenCalledWith('tenant-1781');
			// 整合性維持: Stripe 失敗時は settings に soft-delete を記録しない
			expect(mockSoftDelete).not.toHaveBeenCalled();
			expect(mockDeleteOwnerOnly).not.toHaveBeenCalled();
		});

		it('owner 以外は 403', async () => {
			const res = await POST(makeEvent({ pattern: 'owner-only', role: 'parent' }));
			expect(res.status).toBe(403);
			expect(mockResolveFullPlanTier).not.toHaveBeenCalled();
			expect(mockSoftDelete).not.toHaveBeenCalled();
		});
	});

	describe('owner-full-delete パターン', () => {
		it('free プラン: 即時 deleteOwnerFullDelete を呼ぶ', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
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
			expect(mockSoftDelete).not.toHaveBeenCalled();
			expect(mockCancelSubscription).not.toHaveBeenCalled();
		});

		it('family プラン: cancelSubscription → softDeleteTenant の順、物理削除は cron 待ち', async () => {
			mockResolveFullPlanTier.mockResolvedValue('family');
			mockCancelSubscription.mockResolvedValue({ ok: true });
			mockSoftDelete.mockResolvedValue({
				success: true,
				softDeletedAt: '2026-05-01T00:00:00.000Z',
				gracePeriodDays: 30,
				physicalDeletionDate: '2026-05-31T00:00:00.000Z',
				requiresImmediateDeletion: false,
			});

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
			expect(mockSoftDelete).toHaveBeenCalled();
			expect(mockDeleteOwnerFull).not.toHaveBeenCalled();
			// #1811: 順序検証
			const cancelOrder = mockCancelSubscription.mock.invocationCallOrder[0] ?? -1;
			const softDeleteOrder = mockSoftDelete.mock.invocationCallOrder[0] ?? -1;
			expect(cancelOrder).toBeGreaterThan(0);
			expect(softDeleteOrder).toBeGreaterThan(0);
			expect(cancelOrder).toBeLessThan(softDeleteOrder);
		});

		it('#1811: family プラン Stripe 失敗時は softDeleteTenant を呼ばず 500 を返す', async () => {
			mockResolveFullPlanTier.mockResolvedValue('family');
			mockCancelSubscription.mockRejectedValue(new Error('Stripe API timeout'));

			const res = await POST(
				makeEvent({
					pattern: 'owner-full-delete',
					licenseStatus: 'active',
					plan: 'family-monthly',
				}),
			);

			expect(res.status).toBe(500);
			expect(mockCancelSubscription).toHaveBeenCalledWith('tenant-1781');
			expect(mockSoftDelete).not.toHaveBeenCalled();
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
