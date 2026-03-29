// src/lib/domain/validation/skill-tree.ts
// パッシブスキルツリー ドメイン層（純粋関数）

import type { SkillNode } from '$lib/server/db/types';

// ============================================================
// Effect type definitions
// ============================================================

export const EFFECT_TYPES = [
	'xp_multiplier',
	'point_bonus',
	'streak_shield',
	'combo_bonus',
	'login_bonus',
	'global_xp_multiplier',
] as const;

export type SkillEffectType = (typeof EFFECT_TYPES)[number];

// ============================================================
// スキルノードマスタデータ定義（16ノード）
// ============================================================

export const SKILL_NODE_MASTERS: Omit<SkillNode, 'targetModes'>[] = [
	// ── うんどう（categoryId=1）──
	{
		id: 1,
		categoryId: 1,
		name: 'げんきアップ',
		description: 'うんどうのXPが10%ふえるよ！',
		icon: '💪',
		sortOrder: 1,
		spCost: 1,
		requiredNodeId: null,
		requiredCategoryLevel: 1,
		effectType: 'xp_multiplier',
		effectValue: 0.1,
	},
	{
		id: 2,
		categoryId: 1,
		name: 'きたえろ',
		description: 'うんどうのポイントが+1もらえるよ！',
		icon: '🏋️',
		sortOrder: 2,
		spCost: 2,
		requiredNodeId: 1,
		requiredCategoryLevel: 2,
		effectType: 'point_bonus',
		effectValue: 1,
	},
	{
		id: 3,
		categoryId: 1,
		name: 'アスリートのたましい',
		description: 'れんぞくが1日とぎれてもだいじょうぶ！',
		icon: '🔥',
		sortOrder: 3,
		spCost: 3,
		requiredNodeId: 2,
		requiredCategoryLevel: 3,
		effectType: 'streak_shield',
		effectValue: 1,
	},
	// ── べんきょう（categoryId=2）──
	{
		id: 4,
		categoryId: 2,
		name: 'べんきょうブースト',
		description: 'べんきょうのXPが10%ふえるよ！',
		icon: '📖',
		sortOrder: 1,
		spCost: 1,
		requiredNodeId: null,
		requiredCategoryLevel: 1,
		effectType: 'xp_multiplier',
		effectValue: 0.1,
	},
	{
		id: 5,
		categoryId: 2,
		name: 'しゅうちゅうりょくアップ',
		description: 'べんきょうのポイントが+2もらえるよ！',
		icon: '🧠',
		sortOrder: 2,
		spCost: 2,
		requiredNodeId: 4,
		requiredCategoryLevel: 2,
		effectType: 'point_bonus',
		effectValue: 2,
	},
	{
		id: 6,
		categoryId: 2,
		name: 'ちしきのいずみ',
		description: 'べんきょうのXPがさらに25%ふえるよ！',
		icon: '🏛️',
		sortOrder: 3,
		spCost: 3,
		requiredNodeId: 5,
		requiredCategoryLevel: 3,
		effectType: 'xp_multiplier',
		effectValue: 0.25,
	},
	// ── せいかつ（categoryId=3）──
	{
		id: 7,
		categoryId: 3,
		name: 'せいかつブースト',
		description: 'せいかつのXPが10%ふえるよ！',
		icon: '🏡',
		sortOrder: 1,
		spCost: 1,
		requiredNodeId: null,
		requiredCategoryLevel: 1,
		effectType: 'xp_multiplier',
		effectValue: 0.1,
	},
	{
		id: 8,
		categoryId: 3,
		name: 'ログインボーナス+',
		description: 'ログインボーナスが+3ポイント！',
		icon: '🎁',
		sortOrder: 2,
		spCost: 2,
		requiredNodeId: 7,
		requiredCategoryLevel: 2,
		effectType: 'login_bonus',
		effectValue: 3,
	},
	{
		id: 9,
		categoryId: 3,
		name: 'にちじょうのたつじん',
		description: 'ぜんぶのカテゴリのXPが5%ふえるよ！',
		icon: '🌟',
		sortOrder: 3,
		spCost: 3,
		requiredNodeId: 8,
		requiredCategoryLevel: 3,
		effectType: 'global_xp_multiplier',
		effectValue: 0.05,
	},
	// ── こうりゅう（categoryId=4）──
	{
		id: 10,
		categoryId: 4,
		name: 'こうりゅうブースト',
		description: 'こうりゅうのXPが10%ふえるよ！',
		icon: '🤝',
		sortOrder: 1,
		spCost: 1,
		requiredNodeId: null,
		requiredCategoryLevel: 1,
		effectType: 'xp_multiplier',
		effectValue: 0.1,
	},
	{
		id: 11,
		categoryId: 4,
		name: 'なかよしさん',
		description: 'コンボボーナスが20%アップ！',
		icon: '💕',
		sortOrder: 2,
		spCost: 2,
		requiredNodeId: 10,
		requiredCategoryLevel: 2,
		effectType: 'combo_bonus',
		effectValue: 0.2,
	},
	{
		id: 12,
		categoryId: 4,
		name: 'みんなのリーダー',
		description: 'こうりゅうのXPがさらに25%ふえるよ！',
		icon: '👑',
		sortOrder: 3,
		spCost: 3,
		requiredNodeId: 11,
		requiredCategoryLevel: 3,
		effectType: 'xp_multiplier',
		effectValue: 0.25,
	},
	// ── そうぞう（categoryId=5）──
	{
		id: 13,
		categoryId: 5,
		name: 'そうぞうブースト',
		description: 'そうぞうのXPが10%ふえるよ！',
		icon: '🎨',
		sortOrder: 1,
		spCost: 1,
		requiredNodeId: null,
		requiredCategoryLevel: 1,
		effectType: 'xp_multiplier',
		effectValue: 0.1,
	},
	{
		id: 14,
		categoryId: 5,
		name: 'アイデアマン',
		description: 'そうぞうのポイントが+2もらえるよ！',
		icon: '💡',
		sortOrder: 2,
		spCost: 2,
		requiredNodeId: 13,
		requiredCategoryLevel: 2,
		effectType: 'point_bonus',
		effectValue: 2,
	},
	{
		id: 15,
		categoryId: 5,
		name: 'クリエイティブマスター',
		description: 'そうぞうのXPがさらに25%ふえるよ！',
		icon: '✨',
		sortOrder: 3,
		spCost: 3,
		requiredNodeId: 14,
		requiredCategoryLevel: 3,
		effectType: 'xp_multiplier',
		effectValue: 0.25,
	},
	// ── バランスボーナス（クロスカテゴリ）──
	{
		id: 16,
		categoryId: null,
		name: 'バランスブースト',
		description: 'ぜんぶのカテゴリのXPが5%ふえるよ！\nぜんカテゴリLv2いじょうでかいほう！',
		icon: '🌈',
		sortOrder: 99,
		spCost: 0,
		requiredNodeId: null,
		requiredCategoryLevel: 2,
		effectType: 'global_xp_multiplier',
		effectValue: 0.05,
	},
];

// ============================================================
// 計算関数
// ============================================================

/** カテゴリのXP倍率を算出（累積加算方式: 10% + 25% = 35% → 1.35倍） */
export function calcXpMultiplier(categoryId: number, unlockedNodes: SkillNode[]): number {
	let bonus = 0;
	for (const node of unlockedNodes) {
		if (node.effectType === 'xp_multiplier' && node.categoryId === categoryId) {
			bonus += node.effectValue;
		}
		if (node.effectType === 'global_xp_multiplier') {
			bonus += node.effectValue;
		}
	}
	return 1 + bonus;
}

/** カテゴリのポイントボーナスを算出 */
export function calcPointBonus(categoryId: number, unlockedNodes: SkillNode[]): number {
	let bonus = 0;
	for (const node of unlockedNodes) {
		if (node.effectType === 'point_bonus' && node.categoryId === categoryId) {
			bonus += node.effectValue;
		}
	}
	return bonus;
}

/** ストリークシールドが有効か */
export function hasStreakShield(unlockedNodes: SkillNode[]): boolean {
	return unlockedNodes.some((n) => n.effectType === 'streak_shield');
}

/** コンボボーナス倍率（0.2 = +20%） */
export function calcComboMultiplier(unlockedNodes: SkillNode[]): number {
	let bonus = 0;
	for (const node of unlockedNodes) {
		if (node.effectType === 'combo_bonus') {
			bonus += node.effectValue;
		}
	}
	return 1 + bonus;
}

/** ログインボーナス追加ポイント */
export function calcLoginBonusAddition(unlockedNodes: SkillNode[]): number {
	let bonus = 0;
	for (const node of unlockedNodes) {
		if (node.effectType === 'login_bonus') {
			bonus += node.effectValue;
		}
	}
	return bonus;
}

/** ノードを解放可能か判定 */
export function canUnlockNode(
	node: SkillNode,
	unlockedNodeIds: Set<number>,
	spBalance: number,
	categoryLevels: Record<number, number>,
): { canUnlock: boolean; reason?: string } {
	// 既に解放済み
	if (unlockedNodeIds.has(node.id)) {
		return { canUnlock: false, reason: 'ALREADY_UNLOCKED' };
	}

	// 前提ノードチェック
	if (node.requiredNodeId !== null && !unlockedNodeIds.has(node.requiredNodeId)) {
		return { canUnlock: false, reason: 'PREREQUISITE_NOT_MET' };
	}

	// SP チェック
	if (spBalance < node.spCost) {
		return { canUnlock: false, reason: 'INSUFFICIENT_SP' };
	}

	// バランスノード（categoryId=null）は全カテゴリが要求レベル以上
	if (node.categoryId === null && node.requiredCategoryLevel > 0) {
		if (!isBalanceNodeUnlockable(categoryLevels, node.requiredCategoryLevel)) {
			return { canUnlock: false, reason: 'CATEGORY_LEVEL_NOT_MET' };
		}
		return { canUnlock: true };
	}

	// カテゴリレベルチェック
	if (node.categoryId !== null && node.requiredCategoryLevel > 0) {
		const catLevel = categoryLevels[node.categoryId] ?? 0;
		if (catLevel < node.requiredCategoryLevel) {
			return { canUnlock: false, reason: 'CATEGORY_LEVEL_NOT_MET' };
		}
	}

	return { canUnlock: true };
}

/** バランスノード解放条件: 全カテゴリが指定レベル以上 */
export function isBalanceNodeUnlockable(
	categoryLevels: Record<number, number>,
	requiredLevel: number,
): boolean {
	for (const catId of [1, 2, 3, 4, 5]) {
		if ((categoryLevels[catId] ?? 0) < requiredLevel) {
			return false;
		}
	}
	return true;
}
