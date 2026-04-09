// Preset reward catalog — 新規ユーザー向けのプリセット報酬テンプレート (#581)

import type { RewardCategory } from '$lib/domain/validation/special-reward';

export interface PresetReward {
	title: string;
	points: number;
	icon: string;
	category: RewardCategory;
	tags: readonly string[];
}

export interface PresetRewardGroup {
	groupName: string;
	groupIcon: string;
	rewards: readonly PresetReward[];
}

export const PRESET_REWARD_GROUPS: readonly PresetRewardGroup[] = [
	{
		groupName: 'もの',
		groupIcon: '🎁',
		rewards: [
			{
				title: 'すきなシール',
				points: 50,
				icon: '⭐',
				category: 'other',
				tags: ['baby', 'kinder'],
			},
			{
				title: 'すきなおかし',
				points: 100,
				icon: '🍬',
				category: 'other',
				tags: ['baby', 'kinder', 'lower'],
			},
			{
				title: 'すきな文房具',
				points: 200,
				icon: '✏️',
				category: 'other',
				tags: ['kinder', 'lower', 'upper'],
			},
			{
				title: 'すきな本',
				points: 300,
				icon: '📚',
				category: 'academic',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'すきなおもちゃ',
				points: 500,
				icon: '🧸',
				category: 'other',
				tags: ['baby', 'kinder', 'lower'],
			},
			{
				title: 'すきなマンガ',
				points: 300,
				icon: '📖',
				category: 'other',
				tags: ['lower', 'upper', 'teen'],
			},
		],
	},
	{
		groupName: 'たいけん',
		groupIcon: '🎪',
		rewards: [
			{
				title: 'おでかけ',
				points: 500,
				icon: '🚗',
				category: 'social',
				tags: ['baby', 'kinder', 'lower', 'upper'],
			},
			{
				title: 'がいしょく',
				points: 500,
				icon: '🍽️',
				category: 'social',
				tags: ['kinder', 'lower', 'upper', 'teen'],
			},
			{
				title: 'えいが',
				points: 500,
				icon: '🎬',
				category: 'social',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'ゲーム時間 +30分',
				points: 200,
				icon: '🎮',
				category: 'other',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'YouTube時間 +30分',
				points: 200,
				icon: '📺',
				category: 'other',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'ともだちとおでかけ',
				points: 300,
				icon: '👫',
				category: 'social',
				tags: ['upper', 'teen'],
			},
		],
	},
	{
		groupName: 'おこづかい',
		groupIcon: '💰',
		rewards: [
			{
				title: 'おこづかい 100円',
				points: 200,
				icon: '🪙',
				category: 'other',
				tags: ['kinder', 'lower'],
			},
			{
				title: 'おこづかい 500円',
				points: 500,
				icon: '💴',
				category: 'other',
				tags: ['lower', 'upper'],
			},
			{
				title: 'おこづかい 1000円',
				points: 1000,
				icon: '💵',
				category: 'other',
				tags: ['upper', 'teen'],
			},
		],
	},
	{
		groupName: 'とくべつ',
		groupIcon: '✨',
		rewards: [
			{
				title: 'よふかしけん',
				points: 300,
				icon: '🌙',
				category: 'life',
				tags: ['lower', 'upper'],
			},
			{
				title: 'あさねぼうけん',
				points: 200,
				icon: '😴',
				category: 'life',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'かぞくでゲーム',
				points: 300,
				icon: '🎲',
				category: 'social',
				tags: ['kinder', 'lower', 'upper'],
			},
			{
				title: 'りょこう ちょきん +1000円',
				points: 1000,
				icon: '✈️',
				category: 'other',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'すきなメニュー リクエスト',
				points: 200,
				icon: '🍕',
				category: 'life',
				tags: ['kinder', 'lower', 'upper', 'teen'],
			},
			{
				title: 'ペットとあそぶ時間',
				points: 150,
				icon: '🐕',
				category: 'life',
				tags: ['baby', 'kinder', 'lower'],
			},
		],
	},
] as const;

/** 全プリセット報酬をフラットな配列で返す */
export function getAllPresetRewards(): PresetReward[] {
	return PRESET_REWARD_GROUPS.flatMap((g) => [...g.rewards]);
}
