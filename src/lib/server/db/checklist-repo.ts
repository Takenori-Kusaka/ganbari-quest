// src/lib/server/db/checklist-repo.ts
// チェックリスト リポジトリ層

import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import {
	checklistTemplates,
	checklistTemplateItems,
	checklistLogs,
	checklistOverrides,
} from '$lib/server/db/schema';

// ============================================================
// Templates
// ============================================================

export function findTemplatesByChild(childId: number, includeInactive = false) {
	const rows = db.select().from(checklistTemplates)
		.where(eq(checklistTemplates.childId, childId))
		.all();
	return includeInactive ? rows : rows.filter((r) => r.isActive === 1);
}

export function findTemplateById(id: number) {
	return db.select().from(checklistTemplates)
		.where(eq(checklistTemplates.id, id))
		.get();
}

export function insertTemplate(input: typeof checklistTemplates.$inferInsert) {
	return db.insert(checklistTemplates).values(input).returning().get();
}

export function updateTemplate(id: number, input: Partial<typeof checklistTemplates.$inferInsert>) {
	return db.update(checklistTemplates)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(eq(checklistTemplates.id, id))
		.returning()
		.get();
}

export function deleteTemplate(id: number) {
	db.delete(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, id)).run();
	db.delete(checklistLogs).where(eq(checklistLogs.templateId, id)).run();
	db.delete(checklistTemplates).where(eq(checklistTemplates.id, id)).run();
}

// ============================================================
// Template Items
// ============================================================

export function findTemplateItems(templateId: number) {
	return db.select().from(checklistTemplateItems)
		.where(eq(checklistTemplateItems.templateId, templateId))
		.orderBy(checklistTemplateItems.sortOrder)
		.all();
}

export function insertTemplateItem(input: typeof checklistTemplateItems.$inferInsert) {
	return db.insert(checklistTemplateItems).values(input).returning().get();
}

export function deleteTemplateItem(id: number) {
	db.delete(checklistTemplateItems).where(eq(checklistTemplateItems.id, id)).run();
}

// ============================================================
// Logs (daily check records)
// ============================================================

export function findTodayLog(childId: number, templateId: number, date: string) {
	return db.select().from(checklistLogs)
		.where(
			and(
				eq(checklistLogs.childId, childId),
				eq(checklistLogs.templateId, templateId),
				eq(checklistLogs.checkedDate, date),
			),
		)
		.get();
}

export function upsertLog(input: {
	childId: number;
	templateId: number;
	checkedDate: string;
	itemsJson: string;
	completedAll: number;
	pointsAwarded: number;
}) {
	const existing = findTodayLog(input.childId, input.templateId, input.checkedDate);
	if (existing) {
		return db.update(checklistLogs)
			.set({
				itemsJson: input.itemsJson,
				completedAll: input.completedAll,
				pointsAwarded: input.pointsAwarded,
			})
			.where(eq(checklistLogs.id, existing.id))
			.returning()
			.get();
	}
	return db.insert(checklistLogs).values(input).returning().get();
}

// ============================================================
// Overrides (one-off items)
// ============================================================

export function findOverrides(childId: number, date: string) {
	return db.select().from(checklistOverrides)
		.where(
			and(
				eq(checklistOverrides.childId, childId),
				eq(checklistOverrides.targetDate, date),
			),
		)
		.all();
}

export function insertOverride(input: typeof checklistOverrides.$inferInsert) {
	return db.insert(checklistOverrides).values(input).returning().get();
}

export function deleteOverride(id: number) {
	db.delete(checklistOverrides).where(eq(checklistOverrides.id, id)).run();
}
