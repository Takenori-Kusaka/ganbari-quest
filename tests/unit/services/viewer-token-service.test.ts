// tests/unit/services/viewer-token-service.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindByTenant = vi.fn();
const mockFindByToken = vi.fn();
const mockInsert = vi.fn();
const mockRevoke = vi.fn();
const mockDeleteById = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		viewerToken: {
			findByTenant: (...args: unknown[]) => mockFindByTenant(...args),
			findByToken: (...args: unknown[]) => mockFindByToken(...args),
			insert: (...args: unknown[]) => mockInsert(...args),
			revoke: (...args: unknown[]) => mockRevoke(...args),
			deleteById: (...args: unknown[]) => mockDeleteById(...args),
		},
	}),
}));

import {
	createViewerToken,
	deleteViewerToken,
	listViewerTokens,
	resolveViewerToken,
	revokeViewerToken,
} from '$lib/server/services/viewer-token-service';

describe('viewer-token-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('createViewerToken: 30日間トークンを発行', async () => {
		mockInsert.mockResolvedValue({
			id: 1,
			tenantId: 'test-tenant',
			token: 'abc123',
			label: 'おばあちゃん用',
			expiresAt: '2026-05-04T00:00:00.000Z',
			createdAt: '2026-04-04T00:00:00.000Z',
			revokedAt: null,
		});

		const result = await createViewerToken('test-tenant', {
			label: 'おばあちゃん用',
			duration: '30d',
		});

		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({
				label: 'おばあちゃん用',
				expiresAt: expect.any(String),
			}),
			'test-tenant',
		);
		expect(result.id).toBe(1);
		expect(result.label).toBe('おばあちゃん用');
	});

	it('createViewerToken: 無期限トークンは expiresAt=null', async () => {
		mockInsert.mockResolvedValue({
			id: 2,
			tenantId: 'test-tenant',
			token: 'xyz',
			label: null,
			expiresAt: null,
			createdAt: '2026-04-04T00:00:00.000Z',
			revokedAt: null,
		});

		await createViewerToken('test-tenant', { duration: 'unlimited' });

		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({ expiresAt: null }),
			'test-tenant',
		);
	});

	it('listViewerTokens: テナント一覧を取得', async () => {
		const tokens = [
			{ id: 1, tenantId: 'test-tenant', token: 'a' },
			{ id: 2, tenantId: 'test-tenant', token: 'b' },
		];
		mockFindByTenant.mockResolvedValue(tokens);

		const result = await listViewerTokens('test-tenant');
		expect(result).toHaveLength(2);
		expect(mockFindByTenant).toHaveBeenCalledWith('test-tenant');
	});

	it('resolveViewerToken: 有効なトークンを返す', async () => {
		mockFindByToken.mockResolvedValue({
			id: 1,
			tenantId: 'test-tenant',
			token: 'valid-token',
			revokedAt: null,
			expiresAt: '2099-01-01T00:00:00.000Z',
		});

		const result = await resolveViewerToken('valid-token');
		expect(result).not.toBeNull();
		expect(result?.tenantId).toBe('test-tenant');
	});

	it('resolveViewerToken: 存在しないトークンは null', async () => {
		mockFindByToken.mockResolvedValue(undefined);

		const result = await resolveViewerToken('nonexistent');
		expect(result).toBeNull();
	});

	it('resolveViewerToken: 無効化されたトークンは null', async () => {
		mockFindByToken.mockResolvedValue({
			id: 1,
			tenantId: 'test-tenant',
			token: 'revoked',
			revokedAt: '2026-04-04T00:00:00.000Z',
			expiresAt: null,
		});

		const result = await resolveViewerToken('revoked');
		expect(result).toBeNull();
	});

	it('resolveViewerToken: 期限切れトークンは null', async () => {
		mockFindByToken.mockResolvedValue({
			id: 1,
			tenantId: 'test-tenant',
			token: 'expired',
			revokedAt: null,
			expiresAt: '2020-01-01T00:00:00.000Z',
		});

		const result = await resolveViewerToken('expired');
		expect(result).toBeNull();
	});

	it('revokeViewerToken: repo.revoke を呼ぶ', async () => {
		mockRevoke.mockResolvedValue(undefined);
		await revokeViewerToken(1, 'test-tenant');
		expect(mockRevoke).toHaveBeenCalledWith(1, 'test-tenant');
	});

	it('deleteViewerToken: repo.deleteById を呼ぶ', async () => {
		mockDeleteById.mockResolvedValue(undefined);
		await deleteViewerToken(1, 'test-tenant');
		expect(mockDeleteById).toHaveBeenCalledWith(1, 'test-tenant');
	});
});
