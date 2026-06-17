// src/lib/server/db/checklist-repo.ts — Facade (delegates to factory)
//
// #2362 PR-5 (ADR-0055): family master + assignments method を facade に追加。
//   既存 callsite (`findTemplatesByChild` / `findTemplateById` 等) は後方互換維持。

import type { ArchivedReason } from '$lib/domain/archive-types';
import { getRepos } from './factory';
import type {
	InsertChecklistOverrideInput,
	InsertChecklistTemplateInput,
	InsertChecklistTemplateItemInput,
	UpdateChecklistTemplateInput,
	UpsertChecklistLogInput,
} from './types';

// ── Templates (family scope) ────────────────────────────────────

export async function findTemplatesByTenant(tenantId: string, includeInactive = false) {
	return getRepos().checklist.findTemplatesByTenant(tenantId, includeInactive);
}

export async function findTemplatesByChild(
	childId: number,
	tenantId: string,
	includeInactive = false,
) {
	return getRepos().checklist.findTemplatesByChild(childId, tenantId, includeInactive);
}

export async function findTemplateById(id: number, tenantId: string) {
	return getRepos().checklist.findTemplateById(id, tenantId);
}

export async function insertTemplate(input: InsertChecklistTemplateInput, tenantId: string) {
	return getRepos().checklist.insertTemplate(input, tenantId);
}

export async function updateTemplate(
	id: number,
	input: UpdateChecklistTemplateInput,
	tenantId: string,
) {
	return getRepos().checklist.updateTemplate(id, input, tenantId);
}

export async function deleteTemplate(id: number, tenantId: string) {
	return getRepos().checklist.deleteTemplate(id, tenantId);
}

// ── Distribution (assignments) ──────────────────────────────────

export async function findAssignmentsByTemplate(templateId: number, tenantId: string) {
	return getRepos().checklist.findAssignmentsByTemplate(templateId, tenantId);
}

export async function findAssignmentsByChild(childId: number, tenantId: string) {
	return getRepos().checklist.findAssignmentsByChild(childId, tenantId);
}

export async function assignTemplateToChildren(
	templateId: number,
	childIds: readonly number[],
	tenantId: string,
) {
	return getRepos().checklist.assignTemplateToChildren(templateId, childIds, tenantId);
}

export async function unassignTemplateFromChildren(
	templateId: number,
	childIds: readonly number[],
	tenantId: string,
) {
	return getRepos().checklist.unassignTemplateFromChildren(templateId, childIds, tenantId);
}

export async function unassignTemplate(templateId: number, tenantId: string) {
	return getRepos().checklist.unassignTemplate(templateId, tenantId);
}

// ── Template items ──────────────────────────────────────────────

export async function findTemplateItems(templateId: number, tenantId: string) {
	return getRepos().checklist.findTemplateItems(templateId, tenantId);
}

export async function insertTemplateItem(
	input: InsertChecklistTemplateItemInput,
	tenantId: string,
) {
	return getRepos().checklist.insertTemplateItem(input, tenantId);
}

// #2845 B1: templateId 所有権検証付き (composite key)
export async function deleteTemplateItem(templateId: number, id: number, tenantId: string) {
	return getRepos().checklist.deleteTemplateItem(templateId, id, tenantId);
}

// ── Logs ────────────────────────────────────────────────────────

export async function findTodayLog(
	childId: number,
	templateId: number,
	date: string,
	tenantId: string,
) {
	return getRepos().checklist.findTodayLog(childId, templateId, date, tenantId);
}

export async function upsertLog(input: UpsertChecklistLogInput, tenantId: string) {
	return getRepos().checklist.upsertLog(input, tenantId);
}

/** #3078: child 単位で per-child progress log を全件バルク取得する (export 用)。 */
export async function findLogsByChild(childId: number, tenantId: string) {
	return getRepos().checklist.findLogsByChild(childId, tenantId);
}

// ── Overrides ───────────────────────────────────────────────────

export async function findOverrides(childId: number, date: string, tenantId: string) {
	return getRepos().checklist.findOverrides(childId, date, tenantId);
}

export async function insertOverride(input: InsertChecklistOverrideInput, tenantId: string) {
	return getRepos().checklist.insertOverride(input, tenantId);
}

// #2845 B1: childId 所有権検証付き (composite key)
export async function deleteOverride(childId: number, id: number, tenantId: string) {
	return getRepos().checklist.deleteOverride(childId, id, tenantId);
}

// ── #783: archive / restore ─────────────────────────────────────

// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
export async function archiveChecklistTemplates(
	ids: number[],
	reason: ArchivedReason,
	tenantId: string,
) {
	return getRepos().checklist.archiveChecklistTemplates(ids, reason, tenantId);
}

export async function restoreArchivedChecklistTemplates(reason: ArchivedReason, tenantId: string) {
	return getRepos().checklist.restoreArchivedChecklistTemplates(reason, tenantId);
}
