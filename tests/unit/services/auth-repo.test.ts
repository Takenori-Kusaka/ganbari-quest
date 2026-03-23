// tests/unit/services/auth-repo.test.ts
// DynamoDB auth-repo のユニットテスト (#0123: DeviceToken廃止)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DynamoDB Client モック
const mockSend = vi.fn();

vi.mock('$lib/server/db/dynamodb/client', () => ({
	getDocClient: () => ({ send: mockSend }),
	TABLE_NAME: 'ganbari-quest-test',
	GSI: { GSI1: 'GSI1', GSI2: 'GSI2' },
}));

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('auth-repo: User', () => {
	it('findUserByEmail — ユーザーが見つかる場合', async () => {
		mockSend.mockResolvedValue({
			Items: [
				{
					PK: 'USER#u-abc',
					SK: 'EMAIL#parent@example.com',
					userId: 'u-abc',
					email: 'parent@example.com',
					provider: 'cognito',
					displayName: 'Parent',
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z',
				},
			],
		});

		const { findUserByEmail } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const user = await findUserByEmail('parent@example.com');

		expect(user).toBeDefined();
		expect(user?.userId).toBe('u-abc');
		expect(user?.email).toBe('parent@example.com');
		expect(user?.provider).toBe('cognito');
	});

	it('findUserByEmail — ユーザーが見つからない場合', async () => {
		mockSend.mockResolvedValue({ Items: [] });

		const { findUserByEmail } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const user = await findUserByEmail('unknown@example.com');

		expect(user).toBeUndefined();
	});

	it('findUserById — ユーザーが見つかる場合', async () => {
		mockSend.mockResolvedValue({
			Item: {
				PK: 'USER#u-xyz',
				SK: 'PROFILE',
				userId: 'u-xyz',
				email: 'test@example.com',
				provider: 'cognito',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
			},
		});

		const { findUserById } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const user = await findUserById('u-xyz');

		expect(user).toBeDefined();
		expect(user?.email).toBe('test@example.com');
	});

	it('findUserById — ユーザーが見つからない場合', async () => {
		mockSend.mockResolvedValue({ Item: undefined });

		const { findUserById } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const user = await findUserById('u-nonexistent');

		expect(user).toBeUndefined();
	});

	it('createUser — Profile と Email lookup を作成する', async () => {
		mockSend.mockResolvedValue({});

		const { createUser } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const user = await createUser({
			email: 'new@example.com',
			provider: 'cognito',
			displayName: 'New User',
		});

		expect(user.userId).toMatch(/^u-[0-9a-f-]+$/);
		expect(user.email).toBe('new@example.com');
		expect(user.provider).toBe('cognito');
		expect(user.displayName).toBe('New User');
		expect(user.createdAt).toBeDefined();
		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});

describe('auth-repo: Tenant', () => {
	it('findTenantById — テナントが見つかる場合', async () => {
		mockSend.mockResolvedValue({
			Item: {
				PK: 'TENANT#t-family',
				SK: 'META',
				tenantId: 't-family',
				name: '田中家',
				ownerId: 'u-owner',
				status: 'active',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
			},
		});

		const { findTenantById } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const tenant = await findTenantById('t-family');

		expect(tenant?.name).toBe('田中家');
		expect(tenant?.status).toBe('active');
	});

	it('createTenant — テナントを作成する', async () => {
		mockSend.mockResolvedValue({});

		const { createTenant } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const tenant = await createTenant({ name: '佐藤家', ownerId: 'u-owner' });

		expect(tenant.tenantId).toMatch(/^t-[0-9a-f-]+$/);
		expect(tenant.name).toBe('佐藤家');
		expect(tenant.ownerId).toBe('u-owner');
		expect(tenant.status).toBe('active');
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('updateTenantStatus — テナントステータスを更新する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Item: {
					PK: 'TENANT#t-1',
					SK: 'META',
					tenantId: 't-1',
					name: 'Test',
					ownerId: 'u-1',
					status: 'active',
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z',
				},
			})
			.mockResolvedValueOnce({});

		const { updateTenantStatus } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		await updateTenantStatus('t-1', 'suspended');

		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('updateTenantStatus — テナントが存在しない場合は何もしない', async () => {
		mockSend.mockResolvedValue({ Item: undefined });

		const { updateTenantStatus } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		await updateTenantStatus('t-nonexistent', 'suspended');

		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

describe('auth-repo: Membership', () => {
	it('findMembership — メンバーシップが見つかる場合', async () => {
		mockSend.mockResolvedValue({
			Item: {
				PK: 'TENANT#t-1',
				SK: 'MEMBER#u-1',
				userId: 'u-1',
				tenantId: 't-1',
				role: 'owner',
				joinedAt: '2024-01-01T00:00:00Z',
			},
		});

		const { findMembership } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const m = await findMembership('u-1', 't-1');

		expect(m?.role).toBe('owner');
	});

	it('findUserTenants — ユーザーのテナント一覧', async () => {
		mockSend.mockResolvedValue({
			Items: [
				{ userId: 'u-1', tenantId: 't-A', role: 'owner', joinedAt: '2024-01-01' },
			],
		});

		const { findUserTenants } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const memberships = await findUserTenants('u-1');

		expect(memberships).toHaveLength(1);
		expect(memberships[0]?.tenantId).toBe('t-A');
	});

	it('findTenantMembers — テナントのメンバー一覧', async () => {
		mockSend.mockResolvedValue({
			Items: [
				{ userId: 'u-1', tenantId: 't-1', role: 'owner', joinedAt: '2024-01-01' },
				{ userId: 'u-2', tenantId: 't-1', role: 'parent', joinedAt: '2024-02-01' },
			],
		});

		const { findTenantMembers } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const members = await findTenantMembers('t-1');

		expect(members).toHaveLength(2);
	});

	it('createMembership — 双方向書き込み（Tenant側 + User側）', async () => {
		mockSend.mockResolvedValue({});

		const { createMembership } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		const m = await createMembership({
			userId: 'u-new',
			tenantId: 't-target',
			role: 'parent',
			invitedBy: 'u-owner',
		});

		expect(m.userId).toBe('u-new');
		expect(m.tenantId).toBe('t-target');
		expect(m.role).toBe('parent');
		expect(m.invitedBy).toBe('u-owner');
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('deleteMembership — 双方向削除（Tenant側 + User側）', async () => {
		mockSend.mockResolvedValue({});

		const { deleteMembership } = await import('../../../src/lib/server/db/dynamodb/auth-repo');
		await deleteMembership('u-leave', 't-old');

		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});
