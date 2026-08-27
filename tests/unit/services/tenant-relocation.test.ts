// tests/unit/services/tenant-relocation.test.ts
// #4642: 別の家族グループへの「引っ越し合流」と、無人になった元テナントの掃除。
//
// 招待リンクをうまく踏めず誤って自分だけの家族グループを作ってしまった人が、後から正しい
// 招待に合流できるようにする経路。**不可逆** (元の家族データを消す) なので、誰が実行できるか /
// 失敗したとき何が残るか / 掃除が本当に走るか を固定する。
// 招待・メンバーは local backend で起動できない (#3732) ためサービスを直接結線する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindUserTenants = vi.fn();
const mockFindTenantMembers = vi.fn();
const mockFindUserById = vi.fn();
const mockDeleteMembership = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findUserTenants: mockFindUserTenants,
			findTenantMembers: mockFindTenantMembers,
			findUserById: mockFindUserById,
			deleteMembership: mockDeleteMembership,
		},
	}),
}));

const mockAcceptInvite = vi.fn();
vi.mock('$lib/server/services/invite-service', () => ({
	acceptInvite: (...args: unknown[]) => mockAcceptInvite(...args),
}));

const mockDeleteVacatedTenant = vi.fn();
const mockGetOwnerDeletionInfo = vi.fn();
vi.mock('$lib/server/services/account-deletion-service', () => ({
	deleteVacatedTenant: (...args: unknown[]) => mockDeleteVacatedTenant(...args),
	getOwnerDeletionInfo: (...args: unknown[]) => mockGetOwnerDeletionInfo(...args),
}));

vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: vi.fn(async () => 'free'),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from '$lib/server/logger';
import {
	checkRelocationEligibility,
	relocateToInvitedTenant,
} from '../../../src/lib/server/services/tenant-relocation-service';

const mockLoggerWarn = vi.mocked(logger.warn);
const mockLoggerError = vi.mocked(logger.error);

const USER_ID = 'u-mover';
const OLD_TENANT = 't-own-empty';
const NEW_TENANT = 't-invited-family';
const CODE = 'inv-relocate-4642';
const EMAIL = 'mover@example.com';

/** 「自分ひとりの家族グループの owner」= 引っ越し可能な既定状態。 */
function seedSoleOwner() {
	mockFindUserTenants.mockResolvedValue([
		{ userId: USER_ID, tenantId: OLD_TENANT, role: 'owner', joinedAt: '2026-01-01' },
	]);
	mockGetOwnerDeletionInfo.mockResolvedValue({ isOnlyMember: true, otherMembers: [] });
}

beforeEach(() => {
	vi.clearAllMocks();
	seedSoleOwner();
	mockAcceptInvite.mockResolvedValue({
		membership: { userId: USER_ID, tenantId: NEW_TENANT, role: 'parent' },
	});
	mockDeleteVacatedTenant.mockResolvedValue({ success: true });
});

describe('#4642 引っ越し合流の可否判定', () => {
	it('自分ひとりの家族グループの owner は引っ越せる', async () => {
		await expect(checkRelocationEligibility(USER_ID)).resolves.toEqual({
			currentTenantId: OLD_TENANT,
			blockedReason: null,
		});
	});

	it('他のメンバーが居る家族グループの owner は引っ越せない', async () => {
		mockGetOwnerDeletionInfo.mockResolvedValue({
			isOnlyMember: false,
			otherMembers: [{ userId: 'u-child', role: 'child' }],
		});

		await expect(checkRelocationEligibility(USER_ID)).resolves.toEqual({
			currentTenantId: OLD_TENANT,
			blockedReason: 'HAS_OTHER_MEMBERS',
		});
	});

	it('owner でないメンバーは引っ越せない (先に自分だけ抜ければよい)', async () => {
		mockFindUserTenants.mockResolvedValue([
			{ userId: USER_ID, tenantId: OLD_TENANT, role: 'parent', joinedAt: '2026-01-01' },
		]);

		await expect(checkRelocationEligibility(USER_ID)).resolves.toEqual({
			currentTenantId: OLD_TENANT,
			blockedReason: 'NOT_OWNER',
		});
	});

	it('どこにも所属していなければ引っ越しではない (通常の受諾で足りる)', async () => {
		mockFindUserTenants.mockResolvedValue([]);

		await expect(checkRelocationEligibility(USER_ID)).resolves.toEqual({
			currentTenantId: null,
			blockedReason: 'NO_CURRENT_TENANT',
		});
	});
});

describe('#4642 引っ越し合流の実行', () => {
	it('合流に成功し、元の membership を消して無人テナントを削除する', async () => {
		const result = await relocateToInvitedTenant(CODE, USER_ID, EMAIL, { emailVerified: true });

		expect(result).toEqual({
			ok: true,
			membership: { userId: USER_ID, tenantId: NEW_TENANT, role: 'parent' },
			deletedTenantId: OLD_TENANT,
		});
		expect(mockAcceptInvite).toHaveBeenCalledWith(
			CODE,
			USER_ID,
			EMAIL,
			expect.objectContaining({ allowRelocation: true, emailVerified: true }),
		);
		expect(mockDeleteMembership).toHaveBeenCalledWith(USER_ID, OLD_TENANT);
		expect(mockDeleteVacatedTenant).toHaveBeenCalledWith(
			OLD_TENANT,
			expect.objectContaining({ route: 'relocation' }),
		);
	});

	it('不可逆操作なので監査ログを残す (誰が・どこから・どこへ)', async () => {
		await relocateToInvitedTenant(CODE, USER_ID, EMAIL);

		expect(mockLoggerWarn).toHaveBeenCalledWith(
			expect.stringContaining('[relocation]'),
			expect.objectContaining({
				context: expect.objectContaining({
					userId: USER_ID,
					fromTenantId: OLD_TENANT,
					toTenantId: NEW_TENANT,
				}),
			}),
		);
	});

	it('他メンバーが居るときは受諾も削除も行わない', async () => {
		mockGetOwnerDeletionInfo.mockResolvedValue({
			isOnlyMember: false,
			otherMembers: [{ userId: 'u-child', role: 'child' }],
		});

		const result = await relocateToInvitedTenant(CODE, USER_ID, EMAIL);

		expect(result).toEqual({ ok: false, blockedReason: 'HAS_OTHER_MEMBERS' });
		expect(mockAcceptInvite).not.toHaveBeenCalled();
		expect(mockDeleteMembership).not.toHaveBeenCalled();
		expect(mockDeleteVacatedTenant).not.toHaveBeenCalled();
	});

	it('受諾が拒否されたら元の家族グループを消さない (データを失わせない)', async () => {
		mockAcceptInvite.mockResolvedValue({ error: 'INVITE_EMAIL_MISMATCH' });

		const result = await relocateToInvitedTenant(CODE, USER_ID, EMAIL);

		expect(result).toEqual({ ok: false, acceptError: 'INVITE_EMAIL_MISMATCH' });
		expect(mockDeleteMembership).not.toHaveBeenCalled();
		expect(mockDeleteVacatedTenant).not.toHaveBeenCalled();
	});

	it('掃除に失敗しても引っ越し自体は成立させる (合流できたのにエラー画面にしない)', async () => {
		mockDeleteVacatedTenant.mockRejectedValue(new Error('storage down'));

		const result = await relocateToInvitedTenant(CODE, USER_ID, EMAIL);

		expect(result).toMatchObject({ ok: true, deletedTenantId: OLD_TENANT });
		expect(mockLoggerError).toHaveBeenCalledWith(
			expect.stringContaining('[relocation]'),
			expect.objectContaining({ context: expect.objectContaining({ oldTenantId: OLD_TENANT }) }),
		);
	});
});
