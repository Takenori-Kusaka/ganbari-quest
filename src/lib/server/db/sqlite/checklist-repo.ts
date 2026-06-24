// src/lib/server/db/sqlite/checklist-repo.ts
// チェックリスト リポジトリ (SQLite 実装)
//
// #2362 PR-5 (ADR-0055 / data-model-resource-scope §4.2):
//   family master template + per-child assignments + per-child progress logs。
//   旧 per-child instance (`childId` 列) は migrate-local.ts で family master 化済み。

import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { ArchivedReason } from '$lib/domain/archive-types';
import { db } from '../client';
import {
	checklistLogs,
	checklistOverrides,
	checklistTemplateAssignments,
	checklistTemplateItems,
	checklistTemplates,
} from '../schema';
import type {
	ChecklistLog,
	ChecklistOverride,
	ChecklistTemplate,
	ChecklistTemplateAssignment,
	ChecklistTemplateItem,
	InsertChecklistOverrideInput,
	InsertChecklistTemplateInput,
	InsertChecklistTemplateItemInput,
	UpdateChecklistTemplateInput,
	UpsertChecklistLogInput,
} from '../types';

// ============================================================
// Templates (family scope)
// ============================================================

export async function findTemplatesByTenant(
	tenantId: string,
	includeInactive = false,
): Promise<ChecklistTemplate[]> {
	const rows = db
		.select()
		.from(checklistTemplates)
		.where(
			and(
				eq(checklistTemplates.tenantId, tenantId),
				or(eq(checklistTemplates.isArchived, 0), isNull(checklistTemplates.isArchived)),
			),
		)
		.all();
	return includeInactive ? rows : rows.filter((r) => r.isActive === 1);
}

/**
 * 子供視点で「配信中の family templates」を取得。
 * Phase 1 既存 callsite (`getChecklistsForChild` 等) との後方互換。
 */
export async function findTemplatesByChild(
	childId: number,
	tenantId: string,
	includeInactive = false,
	// #3106: archive 済 template を含めるか (export/backup 文脈のみ true)
	includeArchived = false,
): Promise<ChecklistTemplate[]> {
	const rows = db
		.select({
			id: checklistTemplates.id,
			tenantId: checklistTemplates.tenantId,
			name: checklistTemplates.name,
			icon: checklistTemplates.icon,
			pointsPerItem: checklistTemplates.pointsPerItem,
			completionBonus: checklistTemplates.completionBonus,
			timeSlot: checklistTemplates.timeSlot,
			isActive: checklistTemplates.isActive,
			createdAt: checklistTemplates.createdAt,
			updatedAt: checklistTemplates.updatedAt,
			isArchived: checklistTemplates.isArchived,
			archivedReason: checklistTemplates.archivedReason,
			sourcePresetId: checklistTemplates.sourcePresetId,
		})
		.from(checklistTemplates)
		.innerJoin(
			checklistTemplateAssignments,
			eq(checklistTemplateAssignments.templateId, checklistTemplates.id),
		)
		.where(
			and(
				eq(checklistTemplateAssignments.childId, childId),
				eq(checklistTemplates.tenantId, tenantId),
			),
		)
		.all() as ChecklistTemplate[];
	// #3106: isArchived / isActive を in-memory で flag 連動 filter (既定は archived + inactive を除外)
	return rows.filter((r) => {
		if (!includeArchived && r.isArchived === 1) return false;
		if (!includeInactive && r.isActive !== 1) return false;
		return true;
	});
}

export async function findTemplateById(
	id: number,
	tenantId: string,
): Promise<ChecklistTemplate | undefined> {
	return db
		.select()
		.from(checklistTemplates)
		.where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.tenantId, tenantId)))
		.get();
}

export async function insertTemplate(
	input: InsertChecklistTemplateInput,
	tenantId: string,
): Promise<ChecklistTemplate> {
	return db
		.insert(checklistTemplates)
		.values({ ...input, tenantId })
		.returning()
		.get();
}

export async function updateTemplate(
	id: number,
	input: UpdateChecklistTemplateInput,
	tenantId: string,
): Promise<ChecklistTemplate | undefined> {
	return db
		.update(checklistTemplates)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.tenantId, tenantId)))
		.returning()
		.get();
}

export async function deleteTemplate(id: number, tenantId: string): Promise<void> {
	// Cascade: assignments → items → logs → template
	db.delete(checklistTemplateAssignments)
		.where(eq(checklistTemplateAssignments.templateId, id))
		.run();
	db.delete(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, id)).run();
	db.delete(checklistLogs).where(eq(checklistLogs.templateId, id)).run();
	db.delete(checklistTemplates)
		.where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.tenantId, tenantId)))
		.run();
}

// ============================================================
// Distribution (template ↔ child assignments)
// ============================================================

export async function findAssignmentsByTemplate(
	templateId: number,
	_tenantId: string,
): Promise<ChecklistTemplateAssignment[]> {
	return db
		.select()
		.from(checklistTemplateAssignments)
		.where(eq(checklistTemplateAssignments.templateId, templateId))
		.all();
}

export async function findAssignmentsByChild(
	childId: number,
	_tenantId: string,
): Promise<ChecklistTemplateAssignment[]> {
	return db
		.select()
		.from(checklistTemplateAssignments)
		.where(eq(checklistTemplateAssignments.childId, childId))
		.all();
}

export async function assignTemplateToChildren(
	templateId: number,
	childIds: readonly number[],
	_tenantId: string,
): Promise<ChecklistTemplateAssignment[]> {
	if (childIds.length === 0) return [];

	const existing = db
		.select()
		.from(checklistTemplateAssignments)
		.where(
			and(
				eq(checklistTemplateAssignments.templateId, templateId),
				inArray(checklistTemplateAssignments.childId, [...childIds]),
			),
		)
		.all();
	const existingSet = new Set(existing.map((r) => r.childId));
	const toInsert = childIds.filter((c) => !existingSet.has(c));
	if (toInsert.length === 0) return [];

	const inserted: ChecklistTemplateAssignment[] = [];
	for (const childId of toInsert) {
		const row = db
			.insert(checklistTemplateAssignments)
			.values({ templateId, childId })
			.returning()
			.get();
		inserted.push(row);
	}
	return inserted;
}

export async function unassignTemplateFromChildren(
	templateId: number,
	childIds: readonly number[],
	_tenantId: string,
): Promise<void> {
	if (childIds.length === 0) return;
	db.delete(checklistTemplateAssignments)
		.where(
			and(
				eq(checklistTemplateAssignments.templateId, templateId),
				inArray(checklistTemplateAssignments.childId, [...childIds]),
			),
		)
		.run();
}

export async function unassignTemplate(templateId: number, _tenantId: string): Promise<void> {
	db.delete(checklistTemplateAssignments)
		.where(eq(checklistTemplateAssignments.templateId, templateId))
		.run();
}

// ============================================================
// Template Items
// ============================================================

export async function findTemplateItems(
	templateId: number,
	_tenantId: string,
): Promise<ChecklistTemplateItem[]> {
	return db
		.select()
		.from(checklistTemplateItems)
		.where(eq(checklistTemplateItems.templateId, templateId))
		.orderBy(checklistTemplateItems.sortOrder)
		.all();
}

export async function insertTemplateItem(
	input: InsertChecklistTemplateItemInput,
	_tenantId: string,
): Promise<ChecklistTemplateItem> {
	return db.insert(checklistTemplateItems).values(input).returning().get();
}

/** #2845 B1: templateId 所有権検証付き (composite key)。不一致なら affected 0 の no-op。 */
export async function deleteTemplateItem(
	templateId: number,
	id: number,
	_tenantId: string,
): Promise<void> {
	db.delete(checklistTemplateItems)
		.where(
			and(eq(checklistTemplateItems.id, id), eq(checklistTemplateItems.templateId, templateId)),
		)
		.run();
}

// ============================================================
// Logs (per-child daily check records)
// ============================================================

export async function findTodayLog(
	childId: number,
	templateId: number,
	date: string,
	_tenantId: string,
): Promise<ChecklistLog | undefined> {
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
	input: UpsertChecklistLogInput,
	tenantId: string,
): Promise<ChecklistLog> {
	const existing = await findTodayLog(input.childId, input.templateId, input.checkedDate, tenantId);
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

/**
 * #3078: child 単位で per-child progress log を全件バルク取得する (export 用)。
 */
export async function findLogsByChild(childId: number, _tenantId: string): Promise<ChecklistLog[]> {
	return db
		.select()
		.from(checklistLogs)
		.where(eq(checklistLogs.childId, childId))
		.orderBy(desc(checklistLogs.checkedDate))
		.all();
}

// ============================================================
// Overrides (per-child one-off items)
// ============================================================

export async function findOverrides(
	childId: number,
	date: string,
	_tenantId: string,
): Promise<ChecklistOverride[]> {
	return db
		.select()
		.from(checklistOverrides)
		.where(and(eq(checklistOverrides.childId, childId), eq(checklistOverrides.targetDate, date)))
		.all();
}

export async function insertOverride(
	input: InsertChecklistOverrideInput,
	_tenantId: string,
): Promise<ChecklistOverride> {
	return db.insert(checklistOverrides).values(input).returning().get();
}

/** #2845 B1: childId 所有権検証付き (composite key)。不一致なら affected 0 の no-op。 */
export async function deleteOverride(
	childId: number,
	id: number,
	_tenantId: string,
): Promise<void> {
	db.delete(checklistOverrides)
		.where(and(eq(checklistOverrides.id, id), eq(checklistOverrides.childId, childId)))
		.run();
}

/** テナントの全チェックリストデータを削除 (SQLite: シングルテナントのため全行削除) */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(checklistOverrides).run();
	db.delete(checklistLogs).run();
	db.delete(checklistTemplateAssignments).run();
	db.delete(checklistTemplateItems).run();
	db.delete(checklistTemplates).run();
}

// ============================================================
// #783: archive / restore (family scope)
// Phase 7 PR-2a (#2688): reason 引数を `ArchivedReason` 型に強制 (PR-1 #2685 で配備済の
// `ARCHIVED_REASONS` SSOT integration)。schema.ts L448 の enum 制約と同期で型安全担保。
// ============================================================

export async function archiveChecklistTemplates(
	ids: number[],
	reason: ArchivedReason,
	tenantId: string,
): Promise<void> {
	if (ids.length === 0) return;
	for (const id of ids) {
		db.update(checklistTemplates)
			.set({ isArchived: 1, archivedReason: reason, updatedAt: new Date().toISOString() })
			.where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.tenantId, tenantId)))
			.run();
	}
}

export async function restoreArchivedChecklistTemplates(
	reason: ArchivedReason,
	tenantId: string,
): Promise<void> {
	db.update(checklistTemplates)
		.set({ isArchived: 0, archivedReason: null, updatedAt: new Date().toISOString() })
		.where(
			and(eq(checklistTemplates.tenantId, tenantId), eq(checklistTemplates.archivedReason, reason)),
		)
		.run();
}
