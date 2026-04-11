// tests/unit/domain/preset-rewards.test.ts
// プリセット報酬カタログのスキーマ整合性テスト (#581)

import { describe, expect, it } from 'vitest';
import { getAllPresetRewards, PRESET_REWARD_GROUPS } from '$lib/data/preset-rewards';
import { REWARD_CATEGORIES } from '$lib/domain/validation/special-reward';

describe('PRESET_REWARD_GROUPS', () => {
	it('4グループ存在する', () => {
		expect(PRESET_REWARD_GROUPS).toHaveLength(4);
	});

	it('全グループに groupName と groupIcon がある', () => {
		for (const group of PRESET_REWARD_GROUPS) {
			expect(group.groupName).not.toBe('');
			expect(group.groupIcon).not.toBe('');
		}
	});

	it('全グループに1つ以上の報酬がある', () => {
		for (const group of PRESET_REWARD_GROUPS) {
			expect(group.rewards.length).toBeGreaterThan(0);
		}
	});
});

describe('プリセット報酬の個々の項目', () => {
	const allRewards = getAllPresetRewards();

	it('21件以上のプリセット報酬がある', () => {
		expect(allRewards.length).toBeGreaterThanOrEqual(21);
	});

	it('全報酬に title がある', () => {
		for (const reward of allRewards) {
			expect(reward.title).not.toBe('');
		}
	});

	it('全報酬の points が正の整数', () => {
		for (const reward of allRewards) {
			expect(reward.points).toBeGreaterThan(0);
			expect(Number.isInteger(reward.points)).toBe(true);
		}
	});

	it('全報酬に icon がある', () => {
		for (const reward of allRewards) {
			expect(reward.icon).not.toBe('');
		}
	});

	it('全報酬の category が有効な RewardCategory', () => {
		for (const reward of allRewards) {
			expect(REWARD_CATEGORIES).toContain(reward.category);
		}
	});

	it('全報酬に tags が1つ以上ある', () => {
		for (const reward of allRewards) {
			expect(reward.tags.length).toBeGreaterThan(0);
		}
	});

	it('tags は有効な年齢タグのみ', () => {
		const validTags = new Set(['baby', 'kinder', 'lower', 'upper', 'teen']);
		for (const reward of allRewards) {
			for (const tag of reward.tags) {
				expect(validTags).toContain(tag);
			}
		}
	});

	it('タイトルに重複がない', () => {
		const titles = allRewards.map((r) => r.title);
		expect(new Set(titles).size).toBe(titles.length);
	});
});
