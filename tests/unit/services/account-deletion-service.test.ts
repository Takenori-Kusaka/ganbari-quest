// tests/unit/services/account-deletion-service.test.ts
// アカウント削除サービスのユニットテスト (#458)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Top-level mocks ---

const mockAuthRepo = {
	findTenantById: vi.fn(),
	findTenantMembers: vi.fn(),
	findMembership: vi.fn(),
	findUserById: vi.fn(),
	findTenantInvites: vi.fn(),
	deleteMembership: vi.fn(),
	createMembership: vi.fn(),
	updateTenantOwner: vi.fn(),
	updateInviteStatus: vi.fn(),
	deleteUser: vi.fn(),
	deleteTenant: vi.fn(),
};

const mockChildRepo = {
	findAllChildren: vi.fn(),
	findChildByUserId: vi.fn(),
	deleteChild: vi.fn(),
	updateChild: vi.fn(),
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: mockAuthRepo,
		child: mockChildRepo,
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('$lib/server/storage', () => ({
	deleteByPrefix: vi.fn().mockResolvedValue(0),
}));

vi.mock('./child-service', () => ({
	deleteChildFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/services/child-service', () => ({
	deleteChildFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyDeletionComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/services/email-service', () => ({
	sendDeletionCompleteEmail: vi.fn().mockResolvedValue(true),
	sendMemberRemovedEmail: vi.fn().mockResolvedValue(true),
}));

// Mock Cognito client
vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
	const mockSend = vi.fn().mockResolvedValue({});
	return {
		CognitoIdentityProviderClient: class {
			send = mockSend;
		},
		AdminDeleteUserCommand: class {
			constructor(public input: unknown) {}
		},
	};
});

// --- Imports (after mocks) ---

import {
	deleteChildAccount,
	deleteMemberAccount,
	deleteOwnerFullDelete,
	deleteOwnerOnlyAccount,
	getOwnerDeletionInfo,
	transferOwnershipAndLeave,
} from '$lib/server/services/account-deletion-service';

const TENANT_ID = 't-test-123';
const OWNER_ID = 'u-owner-123';
const PARENT_ID = 'u-parent-456';
const CHILD_USER_ID = 'u-child-789';

describe('account-deletion-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset env
		process.env.COGNITO_USER_POOL_ID = 'us-east-1_TestPool';
		process.env.AWS_REGION = 'us-east-1';
	});

	describe('getOwnerDeletionInfo', () => {
		it('唯一のメンバーの場合 isOnlyMember = true', async () => {
			mockAuthRepo.findTenantMembers.mockResolvedValue([
				{ userId: OWNER_ID, tenantId: TENANT_ID, role: 'owner' },
			]);

			const info = await getOwnerDeletionInfo(TENANT_ID, OWNER_ID);

			expect(info.isOnlyMember).toBe(true);
			expect(info.otherMembers).toHaveLength(0);
		});

		it('他メンバーがいる場合 isOnlyMember = false', async () => {
			mockAuthRepo.findTenantMembers.mockResolvedValue([
				{ userId: OWNER_ID, tenantId: TENANT_ID, role: 'owner' },
				{ userId: PARENT_ID, tenantId: TENANT_ID, role: 'parent' },
			]);
			mockAuthRepo.findUserById.mockResolvedValue({
				userId: PARENT_ID,
				email: 'parent@example.com',
				displayName: 'Parent',
			});

			const info = await getOwnerDeletionInfo(TENANT_ID, OWNER_ID);

			expect(info.isOnlyMember).toBe(false);
			expect(info.otherMembers).toHaveLength(1);
			expect(info.otherMembers[0]!.userId).toBe(PARENT_ID);
			expect(info.otherMembers[0]!.email).toBe('parent@example.com');
		});
	});

	describe('Pattern 1: deleteOwnerOnlyAccount', () => {
		it('唯一のメンバーなら全データ削除', async () => {
			mockAuthRepo.findTenantMembers.mockResolvedValue([
				{ userId: OWNER_ID, tenantId: TENANT_ID, role: 'owner' },
			]);
			mockChildRepo.findAllChildren.mockResolvedValue([]);
			mockAuthRepo.findTenantInvites.mockResolvedValue([]);
			mockAuthRepo.findUserById.mockResolvedValue({
				userId: OWNER_ID,
				email: 'owner@example.com',
			});

			const result = await deleteOwnerOnlyAccount(TENANT_ID, OWNER_ID);

			expect(result.success).toBe(true);
			expect(result.pattern).toBe('owner-only');
			expect(mockAuthRepo.deleteTenant).toHaveBeenCalledWith(TENANT_ID);
			expect(mockAuthRepo.deleteUser).toHaveBeenCalledWith(OWNER_ID);
		});

		it('他メンバーがいる場合はエラー', async () => {
			mockAuthRepo.findTenantMembers.mockResolvedValue([
				{ userId: OWNER_ID, tenantId: TENANT_ID, role: 'owner' },
				{ userId: PARENT_ID, tenantId: TENANT_ID, role: 'parent' },
			]);

			await expect(deleteOwnerOnlyAccount(TENANT_ID, OWNER_ID)).rejects.toThrow(
				'他のメンバーが存在します',
			);
		});
	});

	describe('Pattern 2a: transferOwnershipAndLeave', () => {
		it('権限移譲 + Owner 離脱', async () => {
			mockAuthRepo.findMembership.mockResolvedValue({
				userId: PARENT_ID,
				tenantId: TENANT_ID,
				role: 'parent',
			});
			mockAuthRepo.findUserById.mockResolvedValue({
				userId: OWNER_ID,
				email: 'owner@example.com',
			});

			const result = await transferOwnershipAndLeave(TENANT_ID, OWNER_ID, PARENT_ID);

			expect(result.success).toBe(true);
			expect(result.pattern).toBe('owner-with-transfer');
			expect(mockAuthRepo.updateTenantOwner).toHaveBeenCalledWith(TENANT_ID, PARENT_ID);
			expect(mockAuthRepo.createMembership).toHaveBeenCalledWith({
				userId: PARENT_ID,
				tenantId: TENANT_ID,
				role: 'owner',
			});
			expect(mockAuthRepo.deleteMembership).toHaveBeenCalledWith(OWNER_ID, TENANT_ID);
			expect(mockAuthRepo.deleteUser).toHaveBeenCalledWith(OWNER_ID);
		});

		it('移譲先が存在しない場合はエラー', async () => {
			mockAuthRepo.findMembership.mockResolvedValue(undefined);

			await expect(
				transferOwnershipAndLeave(TENANT_ID, OWNER_ID, 'nonexistent'),
			).rejects.toThrow('移譲先のメンバーが見つかりません');
		});
	});

	describe('Pattern 2b: deleteOwnerFullDelete', () => {
		it('Owner 全削除（他メンバー所属解除）', async () => {
			mockAuthRepo.findTenantMembers.mockResolvedValue([
				{ userId: OWNER_ID, tenantId: TENANT_ID, role: 'owner' },
				{ userId: PARENT_ID, tenantId: TENANT_ID, role: 'parent' },
			]);
			mockChildRepo.findAllChildren.mockResolvedValue([]);
			mockAuthRepo.findTenantInvites.mockResolvedValue([]);
			mockAuthRepo.findTenantById.mockResolvedValue({
				tenantId: TENANT_ID,
				name: 'テスト家族',
			});
			mockAuthRepo.findUserById.mockImplementation(async (userId: string) => {
				if (userId === OWNER_ID) return { userId: OWNER_ID, email: 'owner@example.com' };
				if (userId === PARENT_ID) return { userId: PARENT_ID, email: 'parent@example.com' };
				return undefined;
			});

			const result = await deleteOwnerFullDelete(TENANT_ID, OWNER_ID);

			expect(result.success).toBe(true);
			expect(result.pattern).toBe('owner-full-delete');
			expect(result.unaffiliatedMembers).toContain(PARENT_ID);
			expect(mockAuthRepo.deleteTenant).toHaveBeenCalledWith(TENANT_ID);
			expect(mockAuthRepo.deleteUser).toHaveBeenCalledWith(OWNER_ID);
		});
	});

	describe('Pattern 3: deleteChildAccount', () => {
		it('子供アカウント削除', async () => {
			mockChildRepo.findChildByUserId.mockResolvedValue({
				id: 1,
				nickname: 'たろう',
				userId: CHILD_USER_ID,
			});
			mockAuthRepo.findUserById.mockResolvedValue({
				userId: CHILD_USER_ID,
				email: 'child@example.com',
			});

			const result = await deleteChildAccount(TENANT_ID, CHILD_USER_ID);

			expect(result.success).toBe(true);
			expect(result.pattern).toBe('child');
			expect(mockChildRepo.updateChild).toHaveBeenCalledWith(
				1,
				{ userId: null },
				TENANT_ID,
			);
			expect(mockAuthRepo.deleteMembership).toHaveBeenCalledWith(CHILD_USER_ID, TENANT_ID);
			expect(mockAuthRepo.deleteUser).toHaveBeenCalledWith(CHILD_USER_ID);
		});

		it('子供レコードがない場合もアカウントは削除', async () => {
			mockChildRepo.findChildByUserId.mockResolvedValue(undefined);
			mockAuthRepo.findUserById.mockResolvedValue({
				userId: CHILD_USER_ID,
				email: 'child@example.com',
			});

			const result = await deleteChildAccount(TENANT_ID, CHILD_USER_ID);

			expect(result.success).toBe(true);
			expect(mockChildRepo.updateChild).not.toHaveBeenCalled();
			expect(mockAuthRepo.deleteMembership).toHaveBeenCalledWith(CHILD_USER_ID, TENANT_ID);
		});
	});

	describe('Pattern 4: deleteMemberAccount', () => {
		it('メンバーアカウント削除', async () => {
			mockAuthRepo.findUserById.mockResolvedValue({
				userId: PARENT_ID,
				email: 'parent@example.com',
			});

			const result = await deleteMemberAccount(TENANT_ID, PARENT_ID);

			expect(result.success).toBe(true);
			expect(result.pattern).toBe('member');
			expect(mockAuthRepo.deleteMembership).toHaveBeenCalledWith(PARENT_ID, TENANT_ID);
			expect(mockAuthRepo.deleteUser).toHaveBeenCalledWith(PARENT_ID);
		});
	});
});
