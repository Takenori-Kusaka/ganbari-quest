// tests/unit/routes/shop-shop-category-priority.test.ts
// #3147: ごほうびショップ load の shopCategory 列優先 + null fallback 検証。
//
// 仕様:
//   - special_rewards.shop_category 列に値があればそれを優先表示する
//     (たとえ title/icon からの deriveShopCategory 推定と異なっても列値が勝つ)。
//   - 列値が null (旧行/未指定) のときのみ deriveShopCategory(title/icon/description)
//     に fallback する (後方互換)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireTenantId = vi.fn();
const mockGetBalance = vi.fn();
const mockGetChildSpecialRewards = vi.fn();
const mockGetRedemptionRequestsForChild = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: mockRequireTenantId,
}));
vi.mock('$lib/server/db/point-repo', () => ({
	getBalance: mockGetBalance,
}));
vi.mock('$lib/server/services/child-service', () => ({
	getChildById: vi.fn(),
}));
vi.mock('$lib/server/services/reward-redemption-service', () => ({
	getRedemptionRequestsForChild: mockGetRedemptionRequestsForChild,
	requestRedemption: vi.fn(),
}));
vi.mock('$lib/server/services/special-reward-service', () => ({
	getChildSpecialRewards: mockGetChildSpecialRewards,
}));

const mod = await import('../../../src/routes/(child)/[uiMode=uiMode]/shop/+page.server');
const load = mod.load as unknown as (event: {
	parent: () => Promise<{ child: { id: number } | null }>;
	locals: App.Locals;
}) => Promise<{ rewards: Array<{ id: number; shopCategory: string }> }>;

function makeEvent(child: { id: number } | null) {
	return {
		parent: async () => ({ child }),
		locals: {} as App.Locals,
	};
}

describe('shop load — shopCategory 列優先 + fallback (#3147)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireTenantId.mockReturnValue('tenant-1');
		mockGetBalance.mockResolvedValue(1000);
		mockGetRedemptionRequestsForChild.mockResolvedValue([]);
	});

	it('shop_category 列値があれば deriveShopCategory 推定より列値を優先する', async () => {
		// title「おこづかい」は deriveShopCategory なら money になるが、
		// 列値 physical が明示されているため physical が勝つ。
		mockGetChildSpecialRewards.mockResolvedValue({
			rewards: [
				{
					id: 1,
					title: 'おこづかい100円',
					points: 100,
					icon: '🪙',
					description: null,
					shopCategory: 'physical',
				},
			],
			totalPoints: 0,
		});

		const result = await load(makeEvent({ id: 10 }));
		expect(result.rewards[0]?.shopCategory).toBe('physical');
	});

	it('shop_category 列が null の旧行は title/icon から推定 fallback する', async () => {
		// 列値 null → deriveShopCategory が「おこづかい」「円」「🪙」から money を推定。
		mockGetChildSpecialRewards.mockResolvedValue({
			rewards: [
				{
					id: 2,
					title: 'おこづかい100円',
					points: 100,
					icon: '🪙',
					description: null,
					shopCategory: null,
				},
			],
			totalPoints: 0,
		});

		const result = await load(makeEvent({ id: 10 }));
		expect(result.rewards[0]?.shopCategory).toBe('money');
	});

	it('列値 privilege はそのまま表示される', async () => {
		mockGetChildSpecialRewards.mockResolvedValue({
			rewards: [
				{
					id: 3,
					title: 'なぞのごほうび',
					points: 50,
					icon: '🎁',
					description: null,
					shopCategory: 'privilege',
				},
			],
			totalPoints: 0,
		});

		const result = await load(makeEvent({ id: 10 }));
		expect(result.rewards[0]?.shopCategory).toBe('privilege');
	});
});
