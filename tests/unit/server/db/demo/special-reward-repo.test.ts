// tests/unit/server/db/demo/special-reward-repo.test.ts
// #2097 Phase B-5a: demo Lambda の special-reward (個別演出ごほうび) fixture 検証。
// - findSpecialRewards: 各子供で marketplace reward-set 由来 5 件 (shown 4 + unshown 1)
// - findUnshownReward: idx 0 (shownAt=null) を返し SpecialRewardOverlay (達成プレゼント modal) を発火
// - markRewardShown: stateless stub (undefined を返す、fixture mutate なし)
// - insertSpecialReward: stateless stub (returning input echo)

import { describe, expect, it } from 'vitest';
import * as specialRewardRepo from '../../../../../src/lib/server/db/demo/special-reward-repo';
import { getDemoMarketplaceSpecialRewardsByChild } from '../../../../../src/lib/server/demo/demo-data';

describe('demo/special-reward-repo (#2097 B-5a 達成プレゼント modal 発火)', () => {
	describe('findSpecialRewards: 各子供 reward 件数 (granted / unshown 混在)', () => {
		const expectedChildren = [
			{ id: 902, name: 'ひなちゃん (preschool F)', presetId: 'kinder-rewards' },
			{ id: 903, name: 'けんたくん (elementary M)', presetId: 'elementary-rewards' },
			{ id: 904, name: 'さくらちゃん (junior F)', presetId: 'junior-rewards' },
			{ id: 906, name: 'けいすけくん (senior M)', presetId: 'senior-rewards' },
		];

		for (const child of expectedChildren) {
			it(`${child.id} (${child.name}) で 5 件 (shown 4 + unshown 1)`, async () => {
				const rewards = await specialRewardRepo.findSpecialRewards(child.id, 'demo');
				expect(rewards.length).toBe(5);
				expect(rewards.every((r) => r.childId === child.id)).toBe(true);
				expect(rewards.every((r) => r.sourcePresetId === child.presetId)).toBe(true);
				expect(rewards.every((r) => r.grantedAt !== null)).toBe(true);
				// idx 0 が未表示、idx 1-4 が既表示
				expect(rewards.filter((r) => r.shownAt === null).length).toBe(1);
				expect(rewards.filter((r) => r.shownAt !== null).length).toBe(4);
			});
		}

		it('901 (たろうくん baby、marketplace 対象外) で 0 件', async () => {
			expect(await specialRewardRepo.findSpecialRewards(901, 'demo')).toEqual([]);
		});

		it('存在しない childId (999) で 0 件', async () => {
			expect(await specialRewardRepo.findSpecialRewards(999, 'demo')).toEqual([]);
		});
	});

	describe('findUnshownReward: idx 0 (shownAt=null) を返し modal 発火', () => {
		const expectedChildren = [902, 903, 904, 906];

		for (const childId of expectedChildren) {
			it(`${childId} で unshown reward を 1 件取得 (childId / shownAt=null 整合)`, async () => {
				const unshown = await specialRewardRepo.findUnshownReward(childId, 'demo');
				expect(unshown).toBeDefined();
				expect(unshown?.childId).toBe(childId);
				expect(unshown?.shownAt).toBeNull();
				expect(unshown?.grantedAt).not.toBeNull();
				expect(unshown?.title).toBeDefined();
				expect(unshown?.points).toBeGreaterThan(0);
			});
		}

		it('901 (baby、marketplace 対象外) で undefined (modal 発火なし)', async () => {
			expect(await specialRewardRepo.findUnshownReward(901, 'demo')).toBeUndefined();
		});

		it('findUnshownReward と findSpecialRewards の整合 (idx 0 の id が一致)', async () => {
			const all = await specialRewardRepo.findSpecialRewards(902, 'demo');
			const unshown = await specialRewardRepo.findUnshownReward(902, 'demo');
			expect(unshown?.id).toBe(all[0]?.id);
		});
	});

	describe('markRewardShown: stateless stub (fixture mutate なし)', () => {
		it('markRewardShown は undefined を返す (sqlite repo の returning().get() 整合)', async () => {
			expect(await specialRewardRepo.markRewardShown(5000, 'demo')).toBeUndefined();
		});

		it('markRewardShown 呼出後も findUnshownReward は同じ unshown reward を返す (stateless)', async () => {
			const before = await specialRewardRepo.findUnshownReward(902, 'demo');
			await specialRewardRepo.markRewardShown(before?.id ?? 0, 'demo');
			const after = await specialRewardRepo.findUnshownReward(902, 'demo');
			expect(after?.id).toBe(before?.id);
			expect(after?.shownAt).toBeNull();
		});

		it('markRewardShown 呼出後も fixture (MARKETPLACE_SPECIAL_REWARDS_BY_CHILD) 件数不変', async () => {
			const before = getDemoMarketplaceSpecialRewardsByChild(902).length;
			await specialRewardRepo.markRewardShown(5000, 'demo');
			expect(getDemoMarketplaceSpecialRewardsByChild(902).length).toBe(before);
		});
	});

	describe('insertSpecialReward: stateless stub (input echo)', () => {
		it('insertSpecialReward は input を echo した SpecialReward を返す', async () => {
			const input = {
				childId: 902,
				title: 'テスト報酬',
				points: 50,
				category: 'achievement',
				icon: '🎁',
			};
			const result = await specialRewardRepo.insertSpecialReward(input, 'demo');
			expect(result.childId).toBe(input.childId);
			expect(result.title).toBe(input.title);
			expect(result.points).toBe(input.points);
			expect(result.icon).toBe(input.icon);
			expect(result.shownAt).toBeNull();
		});

		it('insertSpecialReward 呼出後も fixture 件数不変', async () => {
			const before = getDemoMarketplaceSpecialRewardsByChild(902).length;
			await specialRewardRepo.insertSpecialReward(
				{ childId: 902, title: 'x', points: 10, category: 'achievement' },
				'demo',
			);
			expect(getDemoMarketplaceSpecialRewardsByChild(902).length).toBe(before);
		});
	});

	describe('deleteByTenantId: no-op stub', () => {
		it('deleteByTenantId は no-op (Promise<void>)', async () => {
			await expect(specialRewardRepo.deleteByTenantId('demo')).resolves.toBeUndefined();
		});
	});
});
