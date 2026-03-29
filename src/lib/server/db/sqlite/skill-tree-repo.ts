// src/lib/server/db/sqlite/skill-tree-repo.ts
// パッシブスキルツリー リポジトリ（SQLite実装）

import { eq } from 'drizzle-orm';
import { db } from '../client';
import { childSkillNodes, skillNodes, skillPoints } from '../schema';
import type { ChildSkillNode, SkillNode, SkillPoints } from '../types';

export async function findAllSkillNodes(_tenantId: string): Promise<SkillNode[]> {
	return db.select().from(skillNodes).all();
}

export async function findSkillNodeById(
	nodeId: number,
	_tenantId: string,
): Promise<SkillNode | undefined> {
	return db.select().from(skillNodes).where(eq(skillNodes.id, nodeId)).get();
}

export async function findChildSkillNodes(
	childId: number,
	_tenantId: string,
): Promise<ChildSkillNode[]> {
	return db.select().from(childSkillNodes).where(eq(childSkillNodes.childId, childId)).all();
}

export async function insertChildSkillNode(
	childId: number,
	nodeId: number,
	_tenantId: string,
): Promise<ChildSkillNode> {
	const now = new Date().toISOString();
	return db.insert(childSkillNodes).values({ childId, nodeId, unlockedAt: now }).returning().get();
}

export async function findSkillPoints(
	childId: number,
	_tenantId: string,
): Promise<SkillPoints | undefined> {
	return db.select().from(skillPoints).where(eq(skillPoints.childId, childId)).get();
}

export async function upsertSkillPoints(
	childId: number,
	balance: number,
	totalEarned: number,
	totalSpent: number,
	_tenantId: string,
): Promise<SkillPoints> {
	const now = new Date().toISOString();
	const existing = await findSkillPoints(childId, _tenantId);

	if (existing) {
		db.update(skillPoints)
			.set({ balance, totalEarned, totalSpent, updatedAt: now })
			.where(eq(skillPoints.id, existing.id))
			.run();
		return { ...existing, balance, totalEarned, totalSpent, updatedAt: now };
	}

	return db
		.insert(skillPoints)
		.values({ childId, balance, totalEarned, totalSpent, updatedAt: now })
		.returning()
		.get();
}
