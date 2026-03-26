// src/lib/server/db/checklist-repo.ts
// チェックリスト リポジトリ層

import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import {
	checklistLogs,
	checklistOverrides,
	checklistTemplateItems,
	checklistTemplates,
} from '../schema';

// ============================================================
// Templates
// ============================================================

export async function findTemplatesByChild(
	childId: number,
	_tenantId: string,
	includeInactive = false,
) {
	const rows = db
		.select()
		.from(checklistTemplates)
		.where(eq(checklistTemplates.childId, childId))
		.all();
	return includeInactive ? rows : rows.filter((r) => r.isActive === 1);
}

export async function findTemplateById(id: number, _tenantId: string) {
	return db.select().from(checklistTemplates).where(eq(checklistTemplates.id, id)).get();
}

export async function insertTemplate(
	input: {
		childId: number;
		name: string;
		icon?: string;
		pointsPerItem?: number;
		completionBonus?: number;
		isActive?: number;
	},
	_tenantId: string,
) {
	return db.insert(checklistTemplates).values(input).returning().get();
}

export async function updateTemplate(
	id: number,
	input: {
		name?: string;
		icon?: string;
		pointsPerItem?: number;
		completionBonus?: number;
		isActive?: number;
	},
	_tenantId: string,
) {
	return db
		.update(checklistTemplates)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(eq(checklistTemplates.id, id))
		.returning()
		.get();
}

export async function deleteTemplate(id: number, _tenantId: string) {
	db.delete(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, id)).run();
	db.delete(checklistLogs).where(eq(checklistLogs.templateId, id)).run();
	db.delete(checklistTemplates).where(eq(checklistTemplates.id, id)).run();
}

// ============================================================
// Template Items
// ============================================================

export async function findTemplateItems(templateId: number, _tenantId: string) {
	return db
		.select()
		.from(checklistTemplateItems)
		.where(eq(checklistTemplateItems.templateId, templateId))
		.orderBy(checklistTemplateItems.sortOrder)
		.all();
}

export async function insertTemplateItem(
	input: {
		templateId: number;
		name: string;
		icon?: string;
		frequency?: string;
		direction?: string;
		sortOrder?: number;
	},
	_tenantId: string,
) {
	return db.insert(checklistTemplateItems).values(input).returning().get();
}

export async function deleteTemplateItem(id: number, _tenantId: string) {
	db.delete(checklistTemplateItems).where(eq(checklistTemplateItems.id, id)).run();
}

// ============================================================
// Logs (daily check records)
// ============================================================

export async function findTodayLog(
	childId: number,
	templateId: number,
	date: string,
	_tenantId: string,
) {
	return db
		.select()
		.from(checklistLogs)
		.where(
			and(
				eq(checklistLogs.childId, childId),
				eq(checklistLogs.templateId, templateId),
				eq(checklistLogs.checkedDate, date),
			),
		)
		.get();
}

export async function upsertLog(
	input: {
		childId: number;
		templateId: number;
		checkedDate: string;
		itemsJson: string;
		completedAll: number;
		pointsAwarded: number;
	},
	_tenantId: string,
) {
	const existing = await findTodayLog(
		input.childId,
		input.templateId,
		input.checkedDate,
		_tenantId,
	);
	if (existing) {
		return db
			.update(checklistLogs)
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

export async function findOverrides(childId: number, date: string, _tenantId: string) {
	return db
		.select()
		.from(checklistOverrides)
		.where(and(eq(checklistOverrides.childId, childId), eq(checklistOverrides.targetDate, date)))
		.all();
}

export async function insertOverride(
	input: {
		childId: number;
		targetDate: string;
		action: string;
		itemName: string;
		icon?: string;
	},
	_tenantId: string,
) {
	return db.insert(checklistOverrides).values(input).returning().get();
}

export async function deleteOverride(id: number, _tenantId: string) {
	db.delete(checklistOverrides).where(eq(checklistOverrides.id, id)).run();
}
