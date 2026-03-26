import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invite, Membership, Tenant } from '../../../src/lib/server/auth/entities';
import type { IAuthRepo } from '../../../src/lib/server/db/interfaces/auth-repo.interface';

// モック用のインメモリストア
let inviteStore: Map<string, Invite>;
let membershipStore: Membership[];
let tenantStore: Map<string, Tenant>;
let userTenantStore: Map<string, Membership[]>;

function makePendingInvite(overrides: Partial<Invite> = {}): Invite {
	return {
		inviteCode: 'test-code-123',
		tenantId: 't-test',
		invitedBy: 'user-owner',
		role: 'parent',
		status: 'pending',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		...overrides,
	};
}

const mockAuthRepo: Partial<IAuthRepo> = {
	createInvite: vi.fn(async (input) => {
		const invite: Invite = {
			inviteCode: `inv-${Date.now()}`,
			tenantId: input.tenantId,
			invitedBy: input.invitedBy,
			role: input.role,
			childId: input.childId,
			status: 'pending',
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		};
		inviteStore.set(invite.inviteCode, invite);
		return invite;
	}),
	findInviteByCode: vi.fn(async (code: string) => {
		return inviteStore.get(code);
	}),
	updateInviteStatus: vi.fn(async (code: string, status: string, acceptedBy?: string) => {
		const invite = inviteStore.get(code);
		if (invite) {
			invite.status = status as Invite['status'];
			if (acceptedBy) {
				invite.acceptedBy = acceptedBy;
				invite.acceptedAt = new Date().toISOString();
			}
		}
	}),
	findTenantInvites: vi.fn(async (tenantId: string) => {
		return Array.from(inviteStore.values()).filter((i) => i.tenantId === tenantId);
	}),
	findUserTenants: vi.fn(async (userId: string) => {
		return userTenantStore.get(userId) ?? [];
	}),
	findTenantById: vi.fn(async (tenantId: string) => {
		return tenantStore.get(tenantId);
	}),
	createMembership: vi.fn(async (input) => {
		const membership: Membership = {
			userId: input.userId,
			tenantId: input.tenantId,
			role: input.role,
			joinedAt: new Date().toISOString(),
			invitedBy: input.invitedBy,
		};
		membershipStore.push(membership);
		return membership;
	}),
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ auth: mockAuthRepo }),
}));

// invite-service のインポート（mock の後）
import {
	acceptInvite,
	createInvite,
	getInvite,
	listInvites,
	revokeInvite,
} from '../../../src/lib/server/services/invite-service';

beforeEach(() => {
	inviteStore = new Map();
	membershipStore = [];
	tenantStore = new Map();
	userTenantStore = new Map();
	vi.clearAllMocks();
});

describe('createInvite', () => {
	it('parent ロールで招待を作成できる', async () => {
		const invite = await createInvite('t-test', 'user-owner', 'parent');
		expect(invite.tenantId).toBe('t-test');
		expect(invite.invitedBy).toBe('user-owner');
		expect(invite.role).toBe('parent');
		expect(invite.status).toBe('pending');
	});

	it('child ロールで招待を作成できる', async () => {
		const invite = await createInvite('t-test', 'user-owner', 'child', 5);
		expect(invite.role).toBe('child');
		expect(invite.childId).toBe(5);
	});

	it('owner ロールでの招待はエラー', async () => {
		await expect(createInvite('t-test', 'user-owner', 'owner')).rejects.toThrow(
			'ownerロールでの招待はできません',
		);
	});
});

describe('getInvite', () => {
	it('有効な招待コードで招待を取得できる', async () => {
		const invite = makePendingInvite();
		inviteStore.set('test-code-123', invite);

		const result = await getInvite('test-code-123');
		expect(result).not.toBeNull();
		expect(result?.inviteCode).toBe('test-code-123');
	});

	it('存在しないコードは null を返す', async () => {
		const result = await getInvite('nonexistent');
		expect(result).toBeNull();
	});

	it('accepted 状態の招待は null を返す', async () => {
		inviteStore.set('used', makePendingInvite({ inviteCode: 'used', status: 'accepted' }));
		const result = await getInvite('used');
		expect(result).toBeNull();
	});

	it('expired 状態の招待は null を返す', async () => {
		inviteStore.set('exp', makePendingInvite({ inviteCode: 'exp', status: 'expired' }));
		const result = await getInvite('exp');
		expect(result).toBeNull();
	});

	it('期限切れの pending 招待は expired に更新して null を返す', async () => {
		const expired = makePendingInvite({
			inviteCode: 'past',
			expiresAt: new Date(Date.now() - 1000).toISOString(),
		});
		inviteStore.set('past', expired);

		const result = await getInvite('past');
		expect(result).toBeNull();
		expect(mockAuthRepo.updateInviteStatus).toHaveBeenCalledWith('past', 'expired');
	});
});

describe('acceptInvite', () => {
	it('有効な招待でテナントに参加できる', async () => {
		const invite = makePendingInvite({ inviteCode: 'acc-1' });
		inviteStore.set('acc-1', invite);
		tenantStore.set('t-test', {
			tenantId: 't-test',
			status: 'active',
			createdAt: new Date().toISOString(),
		} as Tenant);

		const result = await acceptInvite('acc-1', 'new-user');
		expect('membership' in result).toBe(true);
		if ('membership' in result) {
			expect(result.membership.tenantId).toBe('t-test');
			expect(result.membership.role).toBe('parent');
		}
	});

	it('無効な招待コードはエラー', async () => {
		const result = await acceptInvite('bad-code', 'user');
		expect('error' in result).toBe(true);
		if ('error' in result) {
			expect(result.error).toBe('INVALID_OR_EXPIRED');
		}
	});

	it('既にテナントに所属しているユーザーはエラー', async () => {
		inviteStore.set('acc-2', makePendingInvite({ inviteCode: 'acc-2' }));
		userTenantStore.set('existing-user', [
			{
				userId: 'existing-user',
				tenantId: 't-other',
				role: 'parent',
				joinedAt: new Date().toISOString(),
			},
		]);

		const result = await acceptInvite('acc-2', 'existing-user');
		expect('error' in result).toBe(true);
		if ('error' in result) {
			expect(result.error).toBe('ALREADY_IN_TENANT');
		}
	});

	it('テナントが存在しない場合はエラー', async () => {
		inviteStore.set('acc-3', makePendingInvite({ inviteCode: 'acc-3' }));

		const result = await acceptInvite('acc-3', 'user');
		expect('error' in result).toBe(true);
		if ('error' in result) {
			expect(result.error).toBe('TENANT_NOT_FOUND');
		}
	});
});

describe('revokeInvite', () => {
	it('pending の招待を取り消せる', async () => {
		inviteStore.set('rev-1', makePendingInvite({ inviteCode: 'rev-1' }));

		await revokeInvite('rev-1', 't-test');
		expect(mockAuthRepo.updateInviteStatus).toHaveBeenCalledWith('rev-1', 'revoked');
	});

	it('別テナントの招待は取り消せない', async () => {
		inviteStore.set('rev-2', makePendingInvite({ inviteCode: 'rev-2', tenantId: 't-other' }));

		await revokeInvite('rev-2', 't-test');
		expect(mockAuthRepo.updateInviteStatus).not.toHaveBeenCalled();
	});

	it('既に accepted の招待は取り消せない', async () => {
		inviteStore.set('rev-3', makePendingInvite({ inviteCode: 'rev-3', status: 'accepted' }));

		await revokeInvite('rev-3', 't-test');
		expect(mockAuthRepo.updateInviteStatus).not.toHaveBeenCalled();
	});
});

describe('listInvites', () => {
	it('テナントの招待一覧を取得できる', async () => {
		inviteStore.set('l1', makePendingInvite({ inviteCode: 'l1' }));
		inviteStore.set('l2', makePendingInvite({ inviteCode: 'l2' }));
		inviteStore.set('l3', makePendingInvite({ inviteCode: 'l3', tenantId: 't-other' }));

		const result = await listInvites('t-test');
		expect(result).toHaveLength(2);
	});
});
