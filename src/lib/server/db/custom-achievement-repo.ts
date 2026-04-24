// src/lib/server/db/custom-achievement-repo.ts
// カスタム実績リポジトリ

import { and, desc, eq } from 'drizzle-orm';
import { db } from './client';
import { customAchievements } from './schema';
import type { CustomAchievement, InsertCustomAchievementInput } from './types';

// ============================================================
// Custom Achievements
// ============================================================

export async function insertCustomAchievement(
	input: InsertCustomAchievementInput,
	tenantId: string,
): Promise<CustomAchievement> {
	return db
		.insert(customAchievements)
		.values({
			tenantId,
			childId: input.childId,
			name: input.name,
			description: input.description ?? null,
			icon: input.icon ?? '🏅',
			conditionType: input.conditionType,
			conditionActivityId: input.conditionActivityId ?? null,
			conditionCategoryId: input.conditionCategoryId ?? null,
			conditionValue: input.conditionValue,
			bonusPoints: input.bonusPoints ?? 100,
		})
		.returning()
		.get() as CustomAchievement;
}

export async function findCustomAchievements(
	childId: number,
	tenantId: string,
): Promise<CustomAchievement[]> {
	return db
		.select()
		.from(customAchievements)
		.where(and(eq(customAchievements.childId, childId), eq(customAchievements.tenantId, tenantId)))
		.orderBy(desc(customAchievements.createdAt))
		.all() as CustomAchievement[];
}

async function _findCustomAchievementById(
	id: number,
	tenantId: string,
): Promise<CustomAchievement | undefined> {
	return db
		.select()
		.from(customAchievements)
		.where(and(eq(customAchievements.id, id), eq(customAchievements.tenantId, tenantId)))
		.get() as CustomAchievement | undefined;
}

export async function countCustomAchievements(tenantId: string): Promise<number> {
	const rows = db
		.select({ id: customAchievements.id })
		.from(customAchievements)
		.where(eq(customAchievements.tenantId, tenantId))
		.all();
	return rows.length;
}

export async function unlockCustomAchievement(id: number, tenantId: string): Promise<void> {
	db.update(customAchievements)
		.set({ unlockedAt: new Date().toISOString() })
		.where(and(eq(customAchievements.id, id), eq(customAchievements.tenantId, tenantId)))
		.run();
}

export async function deleteCustomAchievement(id: number, tenantId: string): Promise<boolean> {
	const result = db
		.delete(customAchievements)
		.where(and(eq(customAchievements.id, id), eq(customAchievements.tenantId, tenantId)))
		.run();
	return result.changes > 0;
}
