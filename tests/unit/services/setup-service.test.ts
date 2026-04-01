// tests/unit/services/setup-service.test.ts
// setup-service ユニットテスト — セットアップ要否判定

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAllChildren = vi.fn();

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));

import { isSetupRequired } from '$lib/server/services/setup-service';

describe('setup-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('isSetupRequired', () => {
		it('子供が0人の場合 true を返す', async () => {
			mockGetAllChildren.mockResolvedValue([]);

			const result = await isSetupRequired('tenant-1');

			expect(result).toBe(true);
		});

		it('子供が1人以上いる場合 false を返す', async () => {
			mockGetAllChildren.mockResolvedValue([
				{ id: 1, nickname: 'テスト太郎', tenantId: 'tenant-1' },
			]);

			const result = await isSetupRequired('tenant-1');

			expect(result).toBe(false);
		});

		it('子供が複数人いる場合 false を返す', async () => {
			mockGetAllChildren.mockResolvedValue([
				{ id: 1, nickname: 'テスト太郎', tenantId: 'tenant-1' },
				{ id: 2, nickname: 'テスト花子', tenantId: 'tenant-1' },
				{ id: 3, nickname: 'テスト次郎', tenantId: 'tenant-1' },
			]);

			const result = await isSetupRequired('tenant-1');

			expect(result).toBe(false);
		});

		it('tenantId が正しく getAllChildren に渡される', async () => {
			mockGetAllChildren.mockResolvedValue([]);

			await isSetupRequired('my-tenant-id');

			expect(mockGetAllChildren).toHaveBeenCalledTimes(1);
			expect(mockGetAllChildren).toHaveBeenCalledWith('my-tenant-id');
		});
	});
});
