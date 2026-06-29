// Demo IChecklistRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
//
// #2362 PR-5 (ADR-0055): family master 化対応。
//   - 既存 DEMO_CHECKLIST_TEMPLATES fixture は per-child (childId 列) を持つが、
//     family master read 用の `findTemplatesByTenant` は childId 軸でグルーピング後に
//     family scope view として返す。
//   - `findTemplatesByChild` は既存 fixture の childId を直接使う (after migration の挙動と等価)。
//   - assignments は fixture から仮想生成 (1 template = 1 child assignment)。

import type { ArchivedReason } from '$lib/domain/archive-types';
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
	ChecklistTemplateAssignment,
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
 *
 * #2362 PR-5: fixture 自体は legacy 形 (childId 列を持つ) のままだが、family master 化後の
 * interface に sync させるため、仮想 `tenantId` を 'default' で付与して family master view を生成する。
 * (実 fixture migration は Phase 2 の demo-data.ts 全面刷新で対応)
 */
type LegacyDemoTemplate = ChecklistTemplate & { childId?: number };

const ALL_DEMO_CHECKLIST_TEMPLATES_RAW: LegacyDemoTemplate[] = (() => {
	const seen = new Set<string>();
	const result: LegacyDemoTemplate[] = [];
	for (const t of DEMO_CHECKLIST_TEMPLATES as unknown as LegacyDemoTemplate[]) {
		const key = `${t.childId}::${t.name}`;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(t);
		}
	}
	for (const t of DEMO_MARKETPLACE_CHECKLIST_TEMPLATES as unknown as LegacyDemoTemplate[]) {
		const key = `${t.childId}::${t.name}`;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(t);
		}
	}
	return result;
})();

/** family master view: childId を捨て tenantId='default' で正規化 */
const ALL_DEMO_CHECKLIST_TEMPLATES: ChecklistTemplate[] = ALL_DEMO_CHECKLIST_TEMPLATES_RAW.map(
	(t) => {
		const { childId: _childId, ...rest } = t;
		return { ...rest, tenantId: rest.tenantId ?? 'default' };
	},
);

/** assignments view: legacy childId から仮想生成 (1 row per template × childId) */
const ALL_DEMO_CHECKLIST_ASSIGNMENTS: ChecklistTemplateAssignment[] =
	ALL_DEMO_CHECKLIST_TEMPLATES_RAW.flatMap((t, idx) => {
		if (typeof t.childId !== 'number') return [];
		return [
			{
				id: idx + 1,
				templateId: t.id,
				childId: t.childId,
				createdAt: t.createdAt,
			},
		];
	});

const ALL_DEMO_CHECKLIST_ITEMS: ChecklistTemplateItem[] = [
	...DEMO_CHECKLIST_ITEMS,
	...DEMO_MARKETPLACE_CHECKLIST_ITEMS,
];

// ---------- Templates (family scope) ----------

export async function findTemplatesByTenant(
	_tenantId: string,
	includeInactive?: boolean,
): Promise<ChecklistTemplate[]> {
	return ALL_DEMO_CHECKLIST_TEMPLATES.filter(
		(t) => (includeInactive === true || t.isActive === 1) && t.isArchived === 0,
	);
}

export async function findTemplatesByChild(
	childId: number,
	_tenantId: string,
	includeInactive?: boolean,
	// #3106: archive 済 template を含めるか (export/backup 文脈のみ true)
	includeArchived?: boolean,
): Promise<ChecklistTemplate[]> {
	const assignedIds = new Set(
		ALL_DEMO_CHECKLIST_ASSIGNMENTS.filter((a) => a.childId === childId).map((a) => a.templateId),
	);
	return ALL_DEMO_CHECKLIST_TEMPLATES.filter(
		(t) =>
			assignedIds.has(t.id) &&
			(includeInactive === true || t.isActive === 1) &&
			(includeArchived === true || t.isArchived === 0),
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
	tenantId: string,
): Promise<ChecklistTemplate> {
	const now = new Date().toISOString();
	return {
		id: 0,
		tenantId,
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

// ---------- Distribution (assignments) ----------

export async function findAssignmentsByTemplate(
	templateId: number,
	_tenantId: string,
): Promise<ChecklistTemplateAssignment[]> {
	return ALL_DEMO_CHECKLIST_ASSIGNMENTS.filter((a) => a.templateId === templateId);
}

export async function findAssignmentsByChild(
	childId: number,
	_tenantId: string,
): Promise<ChecklistTemplateAssignment[]> {
	return ALL_DEMO_CHECKLIST_ASSIGNMENTS.filter((a) => a.childId === childId);
}

export async function assignTemplateToChildren(
	_templateId: number,
	_childIds: readonly number[],
	_tenantId: string,
): Promise<ChecklistTemplateAssignment[]> {
	// Stub: no-op (demo は read-only)
	return [];
}

export async function unassignTemplateFromChildren(
	_templateId: number,
	_childIds: readonly number[],
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function unassignTemplate(_templateId: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

// ---------- Template items ----------

export async function findTemplateItems(
	templateId: number,
	_tenantId: string,
): Promise<ChecklistTemplateItem[]> {
	return ALL_DEMO_CHECKLIST_ITEMS.filter((i) => i.templateId === templateId);
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

export async function deleteTemplateItem(
	_templateId: number,
	_id: number,
	_tenantId: string,
): Promise<void> {
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

// #3078: demo fixture には per-child progress log を持たないため空配列を返す。
export async function findLogsByChild(
	_childId: number,
	_tenantId: string,
): Promise<ChecklistLog[]> {
	return [];
}

// ---------- Overrides ----------

export async function findOverrides(
	_childId: number,
	_date: string,
	_tenantId: string,
): Promise<ChecklistOverride[]> {
	return [];
}

export async function findOverridesByChild(
	_childId: number,
	_tenantId: string,
): Promise<ChecklistOverride[]> {
	return [];
}

export async function insertOverrideForRestore(
	input: Omit<ChecklistOverride, 'id'>,
	_tenantId: string,
): Promise<ChecklistOverride> {
	// Stub: demo は書き込み no-op。引数の状態を反映した row を返す。
	return { ...input, id: 0 };
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

export async function deleteOverride(
	_childId: number,
	_id: number,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

// ---------- Archive / Restore ----------
// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。

export async function archiveChecklistTemplates(
	_ids: number[],
	_reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function restoreArchivedChecklistTemplates(
	_reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
