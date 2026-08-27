// tests/unit/services/owner-deletion-transferable-adult.test.ts
// #4640: オーナーを渡せる相手が居るかの判定。
//
// 子供にはオーナーを渡せないため、「自分以外のメンバーが居る」= 移譲できる、ではない。
// 他が子供だけのときに移譲を求めると選択肢が空のまま宙吊りになり、**退会そのものができなくなる**。
// 判定を画面で組み立てず、削除情報の一部として 1 箇所から配ることで、画面ごとに条件がずれない。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantMembers = vi.fn();
const mockFindUserById = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: { findTenantMembers: mockFindTenantMembers, findUserById: mockFindUserById },
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getOwnerDeletionInfo } from '../../../src/lib/server/services/account-deletion-service';

const TENANT = 't-1';
const OWNER = 'u-owner';

beforeEach(() => {
	vi.clearAllMocks();
	mockFindUserById.mockImplementation(async (userId: string) => ({
		userId,
		email: `${userId}@example.com`,
	}));
});

describe('#4640 オーナーを渡せる相手が居るかの判定', () => {
	it('他が子供だけなら渡せる相手は居ない (移譲を求めてはいけない)', async () => {
		mockFindTenantMembers.mockResolvedValue([
			{ userId: OWNER, role: 'owner' },
			{ userId: 'u-child-1', role: 'child' },
			{ userId: 'u-child-2', role: 'child' },
		]);

		const info = await getOwnerDeletionInfo(TENANT, OWNER);

		expect(info.isOnlyMember).toBe(false);
		expect(info.hasTransferableAdult).toBe(false);
	});

	it('大人 (parent) が 1 人でも居れば渡せる', async () => {
		mockFindTenantMembers.mockResolvedValue([
			{ userId: OWNER, role: 'owner' },
			{ userId: 'u-parent', role: 'parent' },
			{ userId: 'u-child', role: 'child' },
		]);

		const info = await getOwnerDeletionInfo(TENANT, OWNER);

		expect(info.hasTransferableAdult).toBe(true);
	});

	it('自分ひとりなら渡せる相手も居ない', async () => {
		mockFindTenantMembers.mockResolvedValue([{ userId: OWNER, role: 'owner' }]);

		const info = await getOwnerDeletionInfo(TENANT, OWNER);

		expect(info.isOnlyMember).toBe(true);
		expect(info.hasTransferableAdult).toBe(false);
	});

	it('自分自身は候補に数えない (自分に渡しても退会できない)', async () => {
		mockFindTenantMembers.mockResolvedValue([
			{ userId: OWNER, role: 'owner' },
			{ userId: 'u-child', role: 'child' },
		]);

		const info = await getOwnerDeletionInfo(TENANT, OWNER);

		expect(info.otherMembers.map((m) => m.userId)).toEqual(['u-child']);
		expect(info.hasTransferableAdult).toBe(false);
	});
});
