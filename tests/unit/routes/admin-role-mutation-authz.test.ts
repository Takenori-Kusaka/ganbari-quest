// tests/unit/routes/admin-role-mutation-authz.test.ts
// #3528 fitness#3 (behavior-preserving): owner 専用 API の ad-hoc role 判定を
// requireRole seam (src/lib/server/auth/guards.ts) に統一する回帰テスト。
//
// テスト観点:
// - transfer-ownership POST / members DELETE の両 route が requireRole(locals, ['owner'])
//   seam を経由して判定していること (red: 現実装はインライン context.role !== 'owner' 判定で
//   requireRole を呼ばないため spy assertion が fail する)
// - negative (parent / child): 403 + 既存 client (admin/members/+page.svelte が d.error を表示)
//   が依存する `{ error: <既存日本語文言> }` body 形が維持されること (回帰固定: 現実装でも green)
// - positive (owner): 成功経路に入り `{ success: true }` が返ること (回帰固定: 現実装でも green)

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
		findMembership: vi.fn(),
		deleteMembership: vi.fn(),
		createMembership: vi.fn(),
		updateTenantOwner: vi.fn(),
		findUserById: vi.fn(),
		findTenantById: vi.fn(),
	},
};
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => mockRepos,
}));

vi.mock('$lib/server/services/email-service', () => ({
	sendMemberJoinedEmail: vi.fn().mockResolvedValue(undefined),
	sendMemberRemovedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { POST: transferOwnership } = await import(
	'../../../src/routes/api/v1/admin/members/[userId]/transfer-ownership/+server'
);
const { DELETE: deleteMember } = await import(
	'../../../src/routes/api/v1/admin/members/[userId]/+server'
);

// ---------- helpers ----------

type Role = 'owner' | 'parent' | 'child';

function createEvent(role: Role, opts: { userId?: string; callerUserId?: string } = {}) {
	const { userId = 'u-target', callerUserId = 'u-caller' } = opts;
	return {
		params: { userId },
		locals: {
			context: { tenantId: 't-test', role },
			identity: { type: 'cognito', userId: callerUserId },
		},
	} as unknown as Parameters<NonNullable<typeof transferOwnership>>[0];
}

// ---------- tests ----------

describe('owner 専用 member mutation API の requireRole seam 統一 (#3528 fitness#3)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRepos.auth.findMembership.mockResolvedValue({ role: 'parent' });
		mockRepos.auth.deleteMembership.mockResolvedValue(undefined);
		mockRepos.auth.createMembership.mockResolvedValue(undefined);
		mockRepos.auth.updateTenantOwner.mockResolvedValue(undefined);
		mockRepos.auth.findUserById.mockResolvedValue({
			email: 'target@example.com',
			displayName: 'ターゲット',
		});
		mockRepos.auth.findTenantById.mockResolvedValue({ name: 'テスト家族' });
	});

	describe('POST /api/v1/admin/members/[userId]/transfer-ownership', () => {
		it('owner は成功経路に入る (positive、回帰固定)', async () => {
			const res = await transferOwnership(createEvent('owner'));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toMatchObject({ success: true });
			expect(mockRepos.auth.updateTenantOwner).toHaveBeenCalledWith('t-test', 'u-target');
		});

		it('owner 判定は requireRole seam 経由で行われる (red → green)', async () => {
			await transferOwnership(createEvent('owner'));
			expect(requireRoleSpy).toHaveBeenCalledWith(
				expect.objectContaining({ context: expect.objectContaining({ role: 'owner' }) }),
				['owner'],
			);
		});

		it('parent は 403 + 既存 {error} body 形を維持 (negative、client d.error 依存の互換固定)', async () => {
			const res = await transferOwnership(createEvent('parent'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ権限を移譲できます' });
			expect(mockRepos.auth.deleteMembership).not.toHaveBeenCalled();
			expect(mockRepos.auth.updateTenantOwner).not.toHaveBeenCalled();
		});

		it('parent 拒否も requireRole seam 経由で判定される (red → green)', async () => {
			await transferOwnership(createEvent('parent'));
			expect(requireRoleSpy).toHaveBeenCalledWith(
				expect.objectContaining({ context: expect.objectContaining({ role: 'parent' }) }),
				['owner'],
			);
		});

		it('child は 403 (negative)', async () => {
			const res = await transferOwnership(createEvent('child'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ権限を移譲できます' });
			expect(mockRepos.auth.updateTenantOwner).not.toHaveBeenCalled();
		});
	});

	describe('DELETE /api/v1/admin/members/[userId]', () => {
		it('owner は成功経路に入る (positive、回帰固定)', async () => {
			const res = await deleteMember(createEvent('owner'));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toMatchObject({ success: true });
			expect(mockRepos.auth.deleteMembership).toHaveBeenCalledWith('u-target', 't-test');
		});

		it('owner 判定は requireRole seam 経由で行われる (red → green)', async () => {
			await deleteMember(createEvent('owner'));
			expect(requireRoleSpy).toHaveBeenCalledWith(
				expect.objectContaining({ context: expect.objectContaining({ role: 'owner' }) }),
				['owner'],
			);
		});

		it('parent は 403 + 既存 {error} body 形を維持 (negative、client d.error 依存の互換固定)', async () => {
			const res = await deleteMember(createEvent('parent'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみメンバーを削除できます' });
			expect(mockRepos.auth.deleteMembership).not.toHaveBeenCalled();
		});

		it('child は 403 (negative)', async () => {
			const res = await deleteMember(createEvent('child'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみメンバーを削除できます' });
			expect(mockRepos.auth.deleteMembership).not.toHaveBeenCalled();
		});
	});
});
