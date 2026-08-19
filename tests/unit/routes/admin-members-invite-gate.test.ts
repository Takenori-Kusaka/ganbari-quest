// tests/unit/routes/admin-members-invite-gate.test.ts (#4704 AC1 / AC3)
//
// 招待できない状態を **押す前に** 画面へ渡す。
//
// 旧実装の load は `isFamily` しか返しておらず、無料プラン (上限 1 = 自分だけ) でも招待フォームが
// そのまま活性で出て、送信して初めて 403「メンバー上限（1人）に達しています」になっていた。
// セルフホスト (local) では API が cognito 前提で 401 を返し、英語の "Unauthorized" が
// 赤枠で画面に出ていた。どちらも「押す前に分かる」形にする。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindTenantMembers = vi.fn();
const mockFindUserById = vi.fn();
const mockCheckFamilyMemberLimit = vi.fn();
const mockGetAuthMode = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			findTenantMembers: mockFindTenantMembers,
			findUserById: mockFindUserById,
		},
	}),
}));

vi.mock('$lib/server/services/invite-service', () => ({
	listInvites: async () => [],
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: async () => [],
}));

vi.mock('$lib/server/services/viewer-token-service', () => ({
	listViewerTokens: async () => [],
}));

vi.mock('$lib/server/services/plan-limit-service', () => ({
	checkFamilyMemberLimit: (...args: unknown[]) => mockCheckFamilyMemberLimit(...args),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
	getAuthMode: () => mockGetAuthMode(),
}));

const { load } = await import('../../../src/routes/(parent)/admin/members/+page.server');
const loadFn = load as unknown as (event: unknown) => Promise<{
	memberLimit: { allowed: boolean; current: number; max: number | null };
	inviteSupported: boolean;
}>;

function event(planTier: 'free' | 'standard' | 'family' = 'free') {
	return {
		locals: {
			context: { tenantId: 't1', role: 'owner', licenseStatus: 'none' },
			identity: { type: 'cognito', userId: 'u1', email: 'owner@example.com' },
		},
		parent: async () => ({ planTier }),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindTenantMembers.mockResolvedValue([{ userId: 'u1', role: 'owner', joinedAt: 'now' }]);
	mockFindUserById.mockResolvedValue({ userId: 'u1', email: 'owner@example.com' });
	mockGetAuthMode.mockReturnValue('cognito');
});

describe('#4704 /admin/members は招待可否を load で解決する', () => {
	it('上限到達 (free = 1 人) を画面に渡す', async () => {
		mockCheckFamilyMemberLimit.mockResolvedValue({ allowed: false, current: 1, max: 1 });

		const result = await loadFn(event('free'));

		expect(result.memberLimit).toEqual({ allowed: false, current: 1, max: 1 });
		expect(mockCheckFamilyMemberLimit).toHaveBeenCalledWith('t1', 'none');
	});

	it('上限内なら allowed=true を渡す (フォームを出してよい)', async () => {
		mockCheckFamilyMemberLimit.mockResolvedValue({ allowed: true, current: 1, max: 4 });

		const result = await loadFn(event('standard'));

		expect(result.memberLimit.allowed).toBe(true);
	});

	it('セルフホスト (local) は inviteSupported=false (招待セクションを出さない)', async () => {
		mockGetAuthMode.mockReturnValue('local');
		mockCheckFamilyMemberLimit.mockResolvedValue({ allowed: true, current: 1, max: null });

		const result = await loadFn(event('family'));

		expect(result.inviteSupported).toBe(false);
	});

	it('cognito では inviteSupported=true', async () => {
		mockCheckFamilyMemberLimit.mockResolvedValue({ allowed: true, current: 1, max: 4 });

		const result = await loadFn(event('standard'));

		expect(result.inviteSupported).toBe(true);
	});
});
