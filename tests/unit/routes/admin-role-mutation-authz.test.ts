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

// #3549 決裁 (a): invites 作成・取消の owner 専用化のための service mocks
const mockCreateInvite = vi.fn();
const mockRevokeInvite = vi.fn();
vi.mock('$lib/server/services/invite-service', () => ({
	createInvite: (...args: unknown[]) => mockCreateInvite(...args),
	revokeInvite: (...args: unknown[]) => mockRevokeInvite(...args),
	listInvites: vi.fn().mockResolvedValue([]),
}));

const mockCheckFamilyMemberLimit = vi.fn();
vi.mock('$lib/server/services/plan-limit-service', () => ({
	checkFamilyMemberLimit: (...args: unknown[]) => mockCheckFamilyMemberLimit(...args),
}));

const mockLoggerWarn = vi.fn();
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: (...a: unknown[]) => mockLoggerWarn(...a), error: vi.fn() },
}));

const { POST: transferOwnership } = await import(
	'../../../src/routes/api/v1/admin/members/[userId]/transfer-ownership/+server'
);
const { DELETE: deleteMember } = await import(
	'../../../src/routes/api/v1/admin/members/[userId]/+server'
);
const { POST: createInvitePost } = await import('../../../src/routes/api/v1/admin/invites/+server');
const { DELETE: revokeInviteDelete } = await import(
	'../../../src/routes/api/v1/admin/invites/[code]/+server'
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

function createInviteCreateEvent(role: Role) {
	return {
		request: new Request('http://localhost/api/v1/admin/invites', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ role: 'parent' }),
		}),
		locals: {
			context: { tenantId: 't-test', role, licenseStatus: 'active' },
			identity: { type: 'cognito', userId: 'u-caller' },
		},
	} as unknown as Parameters<NonNullable<typeof createInvitePost>>[0];
}

function createInviteRevokeEvent(role: Role) {
	return {
		params: { code: 'invite-code-1' },
		locals: {
			context: { tenantId: 't-test', role },
			identity: { type: 'cognito', userId: 'u-caller' },
		},
	} as unknown as Parameters<NonNullable<typeof revokeInviteDelete>>[0];
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

		// #3552 ①: owner 不在化防止 — 移譲先が存在しなければ 404 で早期 return し role を触らない
		it('移譲先メンバーが存在しなければ 404 + role 変更を一切行わない (owner 不在化防止)', async () => {
			mockRepos.auth.findMembership.mockResolvedValueOnce(undefined);
			const res = await transferOwnership(createEvent('owner'));
			expect(res.status).toBe(404);
			await expect(res.json()).resolves.toEqual({ error: '移譲先メンバーが見つかりません' });
			expect(mockRepos.auth.deleteMembership).not.toHaveBeenCalled();
			expect(mockRepos.auth.createMembership).not.toHaveBeenCalled();
			expect(mockRepos.auth.updateTenantOwner).not.toHaveBeenCalled();
		});

		// #3552 ①: 「owner が常に 1 人以上残る」を操作順序で担保 — 新 owner 昇格を旧 owner 降格より
		// 先に行い、中間状態で owner が 0 人になる window を作らない (fail-safe な順序)
		it('新 owner の昇格を旧 owner の降格より先に実行する (owner 0 人 window の排除)', async () => {
			await transferOwnership(createEvent('owner'));

			// target (u-target) を owner に昇格する createMembership 呼び出し
			const promoteOrder = mockRepos.auth.createMembership.mock.calls.findIndex(
				([arg]) => arg.userId === 'u-target' && arg.role === 'owner',
			);
			// 旧 owner (u-caller) を降格するために先立って行う deleteMembership 呼び出し
			const demoteDeleteOrder = mockRepos.auth.deleteMembership.mock.calls.findIndex(
				([userId]) => userId === 'u-caller',
			);
			expect(promoteOrder).toBeGreaterThanOrEqual(0);
			expect(demoteDeleteOrder).toBeGreaterThanOrEqual(0);

			const promoteInvocation =
				mockRepos.auth.createMembership.mock.invocationCallOrder[promoteOrder];
			const demoteDeleteInvocation =
				mockRepos.auth.deleteMembership.mock.invocationCallOrder[demoteDeleteOrder];
			expect(promoteInvocation).toBeDefined();
			expect(demoteDeleteInvocation).toBeDefined();
			// 新 owner を owner に create してから、旧 owner の membership を delete する
			expect(promoteInvocation as number).toBeLessThan(demoteDeleteInvocation as number);
			// 最終的に新 owner が tenant owner に確定する
			expect(mockRepos.auth.updateTenantOwner).toHaveBeenCalledWith('t-test', 'u-target');
		});

		// #3552 ②: role-mutation の 403 拒否は監査ログに残る (濫用試行の追跡)
		it('parent の 403 拒否は監査ログ (logger.warn) に action / actor / target を残す', async () => {
			await transferOwnership(createEvent('parent', { callerUserId: 'u-attacker' }));
			expect(mockLoggerWarn).toHaveBeenCalledWith(
				expect.stringContaining('owner-gate'),
				expect.objectContaining({
					context: expect.objectContaining({
						action: 'members.transfer-ownership',
						actorRole: 'parent',
						actorUserId: 'u-attacker',
						targetId: 'u-target',
					}),
				}),
			);
		});

		it('owner 成功時は監査ログを残さない', async () => {
			await transferOwnership(createEvent('owner'));
			expect(mockLoggerWarn).not.toHaveBeenCalled();
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

	// #3549 PO 決裁 判断1 = (a): 招待作成・取消は owner 専用
	describe('POST /api/v1/admin/invites (#3549 (a) 招待作成の owner 専用化)', () => {
		beforeEach(() => {
			mockCheckFamilyMemberLimit.mockResolvedValue({ allowed: true, current: 1, max: 6 });
			mockCreateInvite.mockResolvedValue({ inviteCode: 'new-code', role: 'parent' });
		});

		it('owner は成功経路に入る (positive)', async () => {
			const res = await createInvitePost(createInviteCreateEvent('owner'));
			expect(res.status).toBe(201);
			await expect(res.json()).resolves.toMatchObject({
				invite: { inviteCode: 'new-code' },
			});
			// #3549 判断2: email 引数 (未入力時 undefined) が追加された 5 引数形
			expect(mockCreateInvite).toHaveBeenCalledWith(
				't-test',
				'u-caller',
				'parent',
				undefined,
				undefined,
			);
		});

		it('owner 判定は requireRole seam 経由で行われる', async () => {
			await createInvitePost(createInviteCreateEvent('owner'));
			expect(requireRoleSpy).toHaveBeenCalledWith(
				expect.objectContaining({ context: expect.objectContaining({ role: 'owner' }) }),
				['owner'],
			);
		});

		it('parent は 403 + {error} body (negative: 現実装では parent が成功するため red)', async () => {
			const res = await createInvitePost(createInviteCreateEvent('parent'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ招待を作成できます' });
			expect(mockCreateInvite).not.toHaveBeenCalled();
		});

		it('child は 403 (negative)', async () => {
			const res = await createInvitePost(createInviteCreateEvent('child'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ招待を作成できます' });
			expect(mockCreateInvite).not.toHaveBeenCalled();
		});
	});

	describe('DELETE /api/v1/admin/invites/[code] (#3549 (a) 招待取消の owner 専用化)', () => {
		beforeEach(() => {
			mockRevokeInvite.mockResolvedValue(undefined);
		});

		it('owner は成功経路に入る (positive)', async () => {
			const res = await revokeInviteDelete(createInviteRevokeEvent('owner'));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({ ok: true });
			expect(mockRevokeInvite).toHaveBeenCalledWith('invite-code-1', 't-test');
		});

		it('owner 判定は requireRole seam 経由で行われる', async () => {
			await revokeInviteDelete(createInviteRevokeEvent('owner'));
			expect(requireRoleSpy).toHaveBeenCalledWith(
				expect.objectContaining({ context: expect.objectContaining({ role: 'owner' }) }),
				['owner'],
			);
		});

		it('parent は 403 + {error} body (negative: 現実装では parent が成功するため red)', async () => {
			const res = await revokeInviteDelete(createInviteRevokeEvent('parent'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ招待を取り消しできます' });
			expect(mockRevokeInvite).not.toHaveBeenCalled();
		});

		it('child は 403 (negative)', async () => {
			const res = await revokeInviteDelete(createInviteRevokeEvent('child'));
			expect(res.status).toBe(403);
			await expect(res.json()).resolves.toEqual({ error: 'owner のみ招待を取り消しできます' });
			expect(mockRevokeInvite).not.toHaveBeenCalled();
		});
	});
});
