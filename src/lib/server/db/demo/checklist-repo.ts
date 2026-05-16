// Demo IChecklistRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import {
	DEMO_CHECKLIST_ITEMS,
	DEMO_CHECKLIST_TEMPLATES,
	DEMO_MARKETPLACE_CHECKLIST_ITEMS,
	DEMO_MARKETPLACE_CHECKLIST_TEMPLATES,
} from '$lib/server/demo/demo-data';
import type {
	ChecklistLog,
	ChecklistOverride,
	ChecklistTemplate,
	ChecklistTemplateItem,
	InsertChecklistOverrideInput,
	InsertChecklistTemplateInput,
	InsertChecklistTemplateItemInput,
	UpdateChecklistTemplateInput,
	UpsertChecklistLogInput,
} from '../types';

/**
 * #2097 Phase B-7: hand-curated DEMO_CHECKLIST_TEMPLATES + marketplace 由来 (903 event-pool / 904 event-school-start)
 * のマージ済み配列。`childId + name` 組合せで dedup する。
 */
const ALL_DEMO_CHECKLIST_TEMPLATES: ChecklistTemplate[] = (() => {
	const seen = new Set<string>();
	const result: ChecklistTemplate[] = [];
	for (const t of DEMO_CHECKLIST_TEMPLATES) {
		const key = `${t.childId}::${t.name}`;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(t);
		}
	}
	for (const t of DEMO_MARKETPLACE_CHECKLIST_TEMPLATES) {
		const key = `${t.childId}::${t.name}`;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(t);
		}
	}
	return result;
})();

const ALL_DEMO_CHECKLIST_ITEMS: ChecklistTemplateItem[] = [
	...DEMO_CHECKLIST_ITEMS,
	...DEMO_MARKETPLACE_CHECKLIST_ITEMS,
];

// ---------- Templates ----------

export async function findTemplatesByChild(
	childId: number,
	_tenantId: string,
	includeInactive?: boolean,
): Promise<ChecklistTemplate[]> {
	return ALL_DEMO_CHECKLIST_TEMPLATES.filter(
		(t) =>
			t.childId === childId && (includeInactive === true || t.isActive === 1) && t.isArchived === 0,
	);
}

export async function findTemplateById(
	id: number,
	_tenantId: string,
): Promise<ChecklistTemplate | undefined> {
	return ALL_DEMO_CHECKLIST_TEMPLATES.find((t) => t.id === id);
}

export async function insertTemplate(
	input: InsertChecklistTemplateInput,
	_tenantId: string,
): Promise<ChecklistTemplate> {
	const now = new Date().toISOString();
	return {
		id: 0,
		childId: input.childId,
		name: input.name,
		icon: input.icon ?? '📋',
		pointsPerItem: input.pointsPerItem ?? 1,
		completionBonus: input.completionBonus ?? 0,
		timeSlot: input.timeSlot ?? 'anytime',
		isActive: input.isActive ?? 1,
		isArchived: 0,
		archivedReason: null,
		createdAt: now,
		updatedAt: now,
		sourcePresetId: input.sourcePresetId ?? null,
	};
}

export async function updateTemplate(
	id: number,
	_input: UpdateChecklistTemplateInput,
	_tenantId: string,
): Promise<ChecklistTemplate | undefined> {
	return ALL_DEMO_CHECKLIST_TEMPLATES.find((t) => t.id === id);
}

export async function deleteTemplate(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

// ---------- Template items ----------

export async function findTemplateItems(
	templateId: number,
	_tenantId: string,
): Promise<ChecklistTemplateItem[]> {
	// 本番 sqlite (src/lib/server/db/sqlite/checklist-repo.ts:67-73) と整合させるため
	// sortOrder 昇順で返す。サービス層が repo の順序保証を前提にしている箇所がある。
	return ALL_DEMO_CHECKLIST_ITEMS.filter((i) => i.templateId === templateId).sort(
		(a, b) => a.sortOrder - b.sortOrder,
	);
}

export async function insertTemplateItem(
	input: InsertChecklistTemplateItemInput,
	_tenantId: string,
): Promise<ChecklistTemplateItem> {
	const now = new Date().toISOString();
	return {
		id: 0,
		templateId: input.templateId,
		name: input.name,
		icon: input.icon ?? '✅',
		frequency: input.frequency ?? 'daily',
		direction: input.direction ?? 'positive',
		sortOrder: input.sortOrder ?? 0,
		createdAt: now,
	};
}

export async function deleteTemplateItem(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

// ---------- Logs ----------

export async function findTodayLog(
	_childId: number,
	_templateId: number,
	_date: string,
	_tenantId: string,
): Promise<ChecklistLog | undefined> {
	return undefined;
}

export async function upsertLog(
	input: UpsertChecklistLogInput,
	_tenantId: string,
): Promise<ChecklistLog> {
	const now = new Date().toISOString();
	return {
		id: 0,
		childId: input.childId,
		templateId: input.templateId,
		checkedDate: input.checkedDate,
		itemsJson: input.itemsJson,
		completedAll: input.completedAll,
		pointsAwarded: input.pointsAwarded,
		createdAt: now,
	};
}

// ---------- Overrides ----------

export async function findOverrides(
	_childId: number,
	_date: string,
	_tenantId: string,
): Promise<ChecklistOverride[]> {
	return [];
}

export async function insertOverride(
	input: InsertChecklistOverrideInput,
	_tenantId: string,
): Promise<ChecklistOverride> {
	const now = new Date().toISOString();
	return {
		id: 0,
		childId: input.childId,
		targetDate: input.targetDate,
		action: input.action,
		itemName: input.itemName,
		icon: input.icon ?? '✅',
		createdAt: now,
	};
}

export async function deleteOverride(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

// ---------- Archive / Restore ----------

export async function archiveChecklistTemplates(
	_ids: number[],
	_reason: string,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function restoreArchivedChecklistTemplates(
	_reason: string,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
