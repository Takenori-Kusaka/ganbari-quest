// src/lib/server/db/custom-achievement-repo.ts
// カスタム実績・称号リポジトリ

import { and, desc, eq } from 'drizzle-orm';
import { db } from './client';
import { customAchievements, customTitles } from './schema';
import type {
	CustomAchievement,
	CustomTitle,
	InsertCustomAchievementInput,
	InsertCustomTitleInput,
} from './types';

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

export async function findCustomAchievementById(
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

// ============================================================
// Custom Titles
// ============================================================

export async function insertCustomTitle(
	input: InsertCustomTitleInput,
	tenantId: string,
): Promise<CustomTitle> {
	return db
		.insert(customTitles)
		.values({
			tenantId,
			childId: input.childId,
			name: input.name,
			icon: input.icon ?? '📛',
			conditionType: input.conditionType,
			conditionValue: input.conditionValue,
			conditionActivityId: input.conditionActivityId ?? null,
		})
		.returning()
		.get() as CustomTitle;
}

export async function findCustomTitles(childId: number, tenantId: string): Promise<CustomTitle[]> {
	return db
		.select()
		.from(customTitles)
		.where(and(eq(customTitles.childId, childId), eq(customTitles.tenantId, tenantId)))
		.orderBy(desc(customTitles.createdAt))
		.all() as CustomTitle[];
}

export async function countCustomTitles(tenantId: string): Promise<number> {
	const rows = db
		.select({ id: customTitles.id })
		.from(customTitles)
		.where(eq(customTitles.tenantId, tenantId))
		.all();
	return rows.length;
}

export async function unlockCustomTitle(id: number, tenantId: string): Promise<void> {
	db.update(customTitles)
		.set({ unlockedAt: new Date().toISOString() })
		.where(and(eq(customTitles.id, id), eq(customTitles.tenantId, tenantId)))
		.run();
}

export async function equipCustomTitle(
	childId: number,
	titleId: number,
	tenantId: string,
): Promise<void> {
	// Unequip all titles for this child
	db.update(customTitles)
		.set({ equipped: 0 })
		.where(and(eq(customTitles.childId, childId), eq(customTitles.tenantId, tenantId)))
		.run();
	// Equip the selected one
	db.update(customTitles)
		.set({ equipped: 1 })
		.where(and(eq(customTitles.id, titleId), eq(customTitles.tenantId, tenantId)))
		.run();
}

export async function deleteCustomTitle(id: number, tenantId: string): Promise<boolean> {
	const result = db
		.delete(customTitles)
		.where(and(eq(customTitles.id, id), eq(customTitles.tenantId, tenantId)))
		.run();
	return result.changes > 0;
}
