// src/lib/ui/sound/sounds.ts
// サウンド定義・年齢帯別設定

import type { UiMode } from '$lib/domain/validation/age-tier';

// --- サウンドID ---

export const SOUND_IDS = [
	'tap',
	'record-complete',
	'point-gain',
	'purchase',
	'level-up',
	'error',
	'special-reward',
	'omikuji-roll',
	'omikuji-result',
	'stamp-press',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

// --- サウンド定義 ---

export const SOUND_DEFS: Record<SoundId, { path: string; label: string }> = {
	tap: { path: '/sounds/tap.mp3', label: 'タップ音' },
	'record-complete': { path: '/sounds/record-complete.mp3', label: '記録完了' },
	'point-gain': { path: '/sounds/point-gain.mp3', label: 'ポイント獲得' },
	purchase: { path: '/sounds/purchase.mp3', label: 'ショップ購入' },
	'level-up': { path: '/sounds/level-up.mp3', label: 'レベルアップ' },
	error: { path: '/sounds/error.mp3', label: 'エラー' },
	'special-reward': { path: '/sounds/special-reward.mp3', label: '特別報酬' },
	'omikuji-roll': { path: '/sounds/omikuji-roll.mp3', label: 'おみくじ回転' },
	'omikuji-result': { path: '/sounds/omikuji-result.mp3', label: 'おみくじ結果' },
	'stamp-press': { path: '/sounds/stamp-press.mp3', label: 'スタンプ押印' },
};

// --- 年齢帯別サウンド設定 ---

export interface SoundTierConfig {
	defaultVolume: number;
	enabledSounds: SoundId[];
}

export const SOUND_TIER_CONFIG: Record<UiMode, SoundTierConfig> = {
	baby: {
		defaultVolume: 0.8,
		enabledSounds: [
			'tap',
			'record-complete',
			'point-gain',
			'purchase',
			'level-up',
			'error',
			'special-reward',
			'omikuji-roll',
			'omikuji-result',
			'stamp-press',
		],
	},
	preschool: {
		defaultVolume: 0.6,
		enabledSounds: [
			'tap',
			'record-complete',
			'point-gain',
			'purchase',
			'level-up',
			'special-reward',
			'omikuji-roll',
			'omikuji-result',
			'stamp-press',
		],
	},
	elementary: {
		defaultVolume: 0.4,
		enabledSounds: [
			'record-complete',
			'purchase',
			'level-up',
			'special-reward',
			'omikuji-result',
			'stamp-press',
		],
	},
	junior: {
		defaultVolume: 0.3,
		enabledSounds: ['level-up', 'special-reward'],
	},
	senior: {
		defaultVolume: 0.2,
		enabledSounds: ['special-reward'],
	},
};
