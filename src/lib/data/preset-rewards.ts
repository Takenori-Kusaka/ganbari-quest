// Preset reward catalog — 新規ユーザー向けのプリセット報酬テンプレート (#581)

import type { RewardCategory } from '$lib/domain/validation/special-reward';

/**
 * ごほうびショップ陳列 3 系統（#1336）
 * - physical: お菓子・文房具・おもちゃ等の現物報酬
 * - money: お小遣い変換（経済リテラシー教育への橋渡し）
 * - privilege: 夜更かし・ゲーム時間・メニューリクエスト等の特権（BusyKid/Greenlight 差別化の核）
 */
export type ShopCategory = 'physical' | 'money' | 'privilege';

export interface PresetReward {
	title: string;
	points: number;
	icon: string;
	category: RewardCategory;
	/** ごほうびショップ陳列 3 系統（#1336） */
	shopCategory: ShopCategory;
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
				shopCategory: 'physical',
				tags: ['baby', 'kinder'],
			},
			{
				title: 'すきなおかし',
				points: 100,
				icon: '🍬',
				category: 'other',
				shopCategory: 'physical',
				tags: ['baby', 'kinder', 'lower'],
			},
			{
				title: 'すきな文房具',
				points: 200,
				icon: '✏️',
				category: 'other',
				shopCategory: 'physical',
				tags: ['kinder', 'lower', 'upper'],
			},
			{
				title: 'すきな本',
				points: 300,
				icon: '📚',
				category: 'academic',
				shopCategory: 'physical',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'すきなおもちゃ',
				points: 500,
				icon: '🧸',
				category: 'other',
				shopCategory: 'physical',
				tags: ['baby', 'kinder', 'lower'],
			},
			{
				title: 'すきなマンガ',
				points: 300,
				icon: '📖',
				category: 'other',
				shopCategory: 'physical',
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
				shopCategory: 'privilege',
				tags: ['baby', 'kinder', 'lower', 'upper'],
			},
			{
				title: 'がいしょく',
				points: 500,
				icon: '🍽️',
				category: 'social',
				shopCategory: 'privilege',
				tags: ['kinder', 'lower', 'upper', 'teen'],
			},
			{
				title: 'えいが',
				points: 500,
				icon: '🎬',
				category: 'social',
				shopCategory: 'privilege',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'ゲーム時間 +30分',
				points: 200,
				icon: '🎮',
				category: 'other',
				shopCategory: 'privilege',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'YouTube時間 +30分',
				points: 200,
				icon: '📺',
				category: 'other',
				shopCategory: 'privilege',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'ともだちとおでかけ',
				points: 300,
				icon: '👫',
				category: 'social',
				shopCategory: 'privilege',
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
				shopCategory: 'money',
				tags: ['kinder', 'lower'],
			},
			{
				title: 'おこづかい 500円',
				points: 500,
				icon: '💴',
				category: 'other',
				shopCategory: 'money',
				tags: ['lower', 'upper'],
			},
			{
				title: 'おこづかい 1000円',
				points: 1000,
				icon: '💵',
				category: 'other',
				shopCategory: 'money',
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
				shopCategory: 'privilege',
				tags: ['lower', 'upper'],
			},
			{
				title: 'あさねぼうけん',
				points: 200,
				icon: '😴',
				category: 'life',
				shopCategory: 'privilege',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'かぞくでゲーム',
				points: 300,
				icon: '🎲',
				category: 'social',
				shopCategory: 'privilege',
				tags: ['kinder', 'lower', 'upper'],
			},
			{
				title: 'りょこう ちょきん +1000円',
				points: 1000,
				icon: '✈️',
				category: 'other',
				shopCategory: 'money',
				tags: ['lower', 'upper', 'teen'],
			},
			{
				title: 'すきなメニュー リクエスト',
				points: 200,
				icon: '🍕',
				category: 'life',
				shopCategory: 'privilege',
				tags: ['kinder', 'lower', 'upper', 'teen'],
			},
			{
				title: 'ペットとあそぶ時間',
				points: 150,
				icon: '🐕',
				category: 'life',
				shopCategory: 'privilege',
				tags: ['baby', 'kinder', 'lower'],
			},
		],
	},
] as const;

/** 全プリセット報酬をフラットな配列で返す */
export function getAllPresetRewards(): PresetReward[] {
	return PRESET_REWARD_GROUPS.flatMap((g) => [...g.rewards]);
}
