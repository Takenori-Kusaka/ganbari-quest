import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { levelTitles } from '../schema';
import type { LevelTitle } from '../types';

export async function findByTenant(tenantId: string): Promise<LevelTitle[]> {
	return db
		.select()
		.from(levelTitles)
		.where(eq(levelTitles.tenantId, tenantId))
		.all() as LevelTitle[];
}

export async function upsert(tenantId: string, level: number, customTitle: string): Promise<void> {
	const now = new Date().toISOString();
	db.insert(levelTitles)
		.values({ tenantId, level, customTitle, updatedAt: now })
		.onConflictDoUpdate({
			target: [levelTitles.tenantId, levelTitles.level],
			set: { customTitle, updatedAt: now },
		})
		.run();
}

export async function deleteByTenantAndLevel(tenantId: string, level: number): Promise<void> {
	db.delete(levelTitles)
		.where(and(eq(levelTitles.tenantId, tenantId), eq(levelTitles.level, level)))
		.run();
}

export async function deleteAllByTenant(tenantId: string): Promise<void> {
	db.delete(levelTitles).where(eq(levelTitles.tenantId, tenantId)).run();
}
