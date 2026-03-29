// src/lib/server/db/skill-tree-repo.ts
// パッシブスキルツリー リポジトリ（Facade）

import { getRepos } from './factory';
import type { ChildSkillNode, SkillNode, SkillPoints } from './types';

export async function findAllSkillNodes(tenantId: string): Promise<SkillNode[]> {
	return getRepos().skillTree.findAllSkillNodes(tenantId);
}

export async function findSkillNodeById(
	nodeId: number,
	tenantId: string,
): Promise<SkillNode | undefined> {
	return getRepos().skillTree.findSkillNodeById(nodeId, tenantId);
}

export async function findChildSkillNodes(
	childId: number,
	tenantId: string,
): Promise<ChildSkillNode[]> {
	return getRepos().skillTree.findChildSkillNodes(childId, tenantId);
}

export async function insertChildSkillNode(
	childId: number,
	nodeId: number,
	tenantId: string,
): Promise<ChildSkillNode> {
	return getRepos().skillTree.insertChildSkillNode(childId, nodeId, tenantId);
}

export async function findSkillPoints(
	childId: number,
	tenantId: string,
): Promise<SkillPoints | undefined> {
	return getRepos().skillTree.findSkillPoints(childId, tenantId);
}

export async function upsertSkillPoints(
	childId: number,
	balance: number,
	totalEarned: number,
	totalSpent: number,
	tenantId: string,
): Promise<SkillPoints> {
	return getRepos().skillTree.upsertSkillPoints(
		childId,
		balance,
		totalEarned,
		totalSpent,
		tenantId,
	);
}
