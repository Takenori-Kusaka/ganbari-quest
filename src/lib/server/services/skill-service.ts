// src/lib/server/services/skill-service.ts
// パッシブスキルツリー サービス層

import {
	calcComboMultiplier,
	calcLoginBonusAddition,
	calcPointBonus,
	calcXpMultiplier,
	canUnlockNode,
	hasStreakShield,
} from '$lib/domain/validation/skill-tree';
import {
	findAllSkillNodes,
	findChildSkillNodes,
	findSkillNodeById,
	findSkillPoints,
	insertChildSkillNode,
	upsertSkillPoints,
} from '$lib/server/db/skill-tree-repo';
import type { SkillNode } from '$lib/server/db/types';

// ============================================================
// Aggregated skill effects (cached per request)
// ============================================================

export interface SkillEffects {
	/** カテゴリ別XP倍率（1.0 = 倍率なし） */
	xpMultipliers: Record<number, number>;
	/** カテゴリ別ポイントボーナス */
	pointBonuses: Record<number, number>;
	/** ストリークシールド有効 */
	streakShield: boolean;
	/** コンボボーナス倍率（1.0 = 倍率なし） */
	comboMultiplier: number;
	/** ログインボーナス追加ポイント */
	loginBonusAddition: number;
}

// ============================================================
// Skill tree data for UI
// ============================================================

export interface SkillNodeView {
	id: number;
	categoryId: number | null;
	name: string;
	description: string | null;
	icon: string;
	sortOrder: number;
	spCost: number;
	requiredNodeId: number | null;
	requiredCategoryLevel: number;
	effectType: string;
	effectValue: number;
	unlocked: boolean;
	canUnlock: boolean;
	unlockReason?: string;
}

export interface SkillTreeData {
	nodes: SkillNodeView[];
	spBalance: number;
	spTotalEarned: number;
}

// ============================================================
// In-memory cache for skill node master data
// ============================================================

let cachedNodes: SkillNode[] | null = null;

async function getSkillNodesMaster(tenantId: string): Promise<SkillNode[]> {
	if (cachedNodes) return cachedNodes;
	cachedNodes = await findAllSkillNodes(tenantId);
	return cachedNodes;
}

// ============================================================
// Public API
// ============================================================

/** 子供のアクティブスキル効果を取得（活動記録時に使用） */
export async function getActiveSkillEffects(
	childId: number,
	tenantId: string,
): Promise<SkillEffects> {
	const allNodes = await getSkillNodesMaster(tenantId);
	const unlocked = await findChildSkillNodes(childId, tenantId);
	const unlockedNodeIds = new Set(unlocked.map((u) => u.nodeId));

	const unlockedNodes = allNodes.filter((n) => unlockedNodeIds.has(n.id));

	const xpMultipliers: Record<number, number> = {};
	for (const catId of [1, 2, 3, 4, 5]) {
		xpMultipliers[catId] = calcXpMultiplier(catId, unlockedNodes);
	}

	const pointBonuses: Record<number, number> = {};
	for (const catId of [1, 2, 3, 4, 5]) {
		pointBonuses[catId] = calcPointBonus(catId, unlockedNodes);
	}

	return {
		xpMultipliers,
		pointBonuses,
		streakShield: hasStreakShield(unlockedNodes),
		comboMultiplier: calcComboMultiplier(unlockedNodes),
		loginBonusAddition: calcLoginBonusAddition(unlockedNodes),
	};
}

/** スキルツリー全データ取得（UI表示用） */
export async function getSkillTree(
	childId: number,
	categoryLevels: Record<number, number>,
	tenantId: string,
): Promise<SkillTreeData> {
	const allNodes = await getSkillNodesMaster(tenantId);
	const unlocked = await findChildSkillNodes(childId, tenantId);
	const unlockedNodeIds = new Set(unlocked.map((u) => u.nodeId));
	const sp = await findSkillPoints(childId, tenantId);
	const spBalance = sp?.balance ?? 0;

	const nodes: SkillNodeView[] = allNodes.map((node) => {
		const isUnlocked = unlockedNodeIds.has(node.id);
		const check = isUnlocked
			? { canUnlock: false as const, reason: 'ALREADY_UNLOCKED' as const }
			: canUnlockNode(node, unlockedNodeIds, spBalance, categoryLevels);

		return {
			id: node.id,
			categoryId: node.categoryId,
			name: node.name,
			description: node.description,
			icon: node.icon,
			sortOrder: node.sortOrder,
			spCost: node.spCost,
			requiredNodeId: node.requiredNodeId,
			requiredCategoryLevel: node.requiredCategoryLevel,
			effectType: node.effectType,
			effectValue: node.effectValue,
			unlocked: isUnlocked,
			canUnlock: check.canUnlock,
			unlockReason: check.reason,
		};
	});

	return {
		nodes,
		spBalance,
		spTotalEarned: sp?.totalEarned ?? 0,
	};
}

/** スキルノードを解放する */
export async function unlockSkillNode(
	childId: number,
	nodeId: number,
	categoryLevels: Record<number, number>,
	tenantId: string,
): Promise<
	| { success: true; node: SkillNodeView }
	| {
			error:
				| 'NOT_FOUND'
				| 'ALREADY_UNLOCKED'
				| 'PREREQUISITE_NOT_MET'
				| 'INSUFFICIENT_SP'
				| 'CATEGORY_LEVEL_NOT_MET';
	  }
> {
	const node = await findSkillNodeById(nodeId, tenantId);
	if (!node) return { error: 'NOT_FOUND' };

	const unlocked = await findChildSkillNodes(childId, tenantId);
	const unlockedNodeIds = new Set(unlocked.map((u) => u.nodeId));
	const sp = await findSkillPoints(childId, tenantId);
	const spBalance = sp?.balance ?? 0;

	const check = canUnlockNode(node, unlockedNodeIds, spBalance, categoryLevels);
	if (!check.canUnlock) {
		return {
			error: check.reason as
				| 'ALREADY_UNLOCKED'
				| 'PREREQUISITE_NOT_MET'
				| 'INSUFFICIENT_SP'
				| 'CATEGORY_LEVEL_NOT_MET',
		};
	}

	// SP消費
	const newBalance = spBalance - node.spCost;
	const totalSpent = (sp?.totalSpent ?? 0) + node.spCost;
	await upsertSkillPoints(childId, newBalance, sp?.totalEarned ?? 0, totalSpent, tenantId);

	// ノード解放
	await insertChildSkillNode(childId, nodeId, tenantId);

	// マスタキャッシュクリア（ノード解放後に再取得されるように）
	cachedNodes = null;

	return {
		success: true,
		node: {
			id: node.id,
			categoryId: node.categoryId,
			name: node.name,
			description: node.description,
			icon: node.icon,
			sortOrder: node.sortOrder,
			spCost: node.spCost,
			requiredNodeId: node.requiredNodeId,
			requiredCategoryLevel: node.requiredCategoryLevel,
			effectType: node.effectType,
			effectValue: node.effectValue,
			unlocked: true,
			canUnlock: false,
		},
	};
}

/** SP を付与する（カテゴリLvUP時に呼ばれる） */
export async function grantSkillPoints(
	childId: number,
	amount: number,
	tenantId: string,
): Promise<{ balance: number; totalEarned: number }> {
	const sp = await findSkillPoints(childId, tenantId);
	const newBalance = (sp?.balance ?? 0) + amount;
	const newTotalEarned = (sp?.totalEarned ?? 0) + amount;
	const result = await upsertSkillPoints(
		childId,
		newBalance,
		newTotalEarned,
		sp?.totalSpent ?? 0,
		tenantId,
	);
	return { balance: result.balance, totalEarned: result.totalEarned };
}

/** SP残高を取得 */
export async function getSkillPointBalance(
	childId: number,
	tenantId: string,
): Promise<{ balance: number; totalEarned: number; totalSpent: number }> {
	const sp = await findSkillPoints(childId, tenantId);
	return {
		balance: sp?.balance ?? 0,
		totalEarned: sp?.totalEarned ?? 0,
		totalSpent: sp?.totalSpent ?? 0,
	};
}
