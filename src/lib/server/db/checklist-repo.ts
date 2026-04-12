// src/lib/server/db/checklist-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type {
	InsertChecklistOverrideInput,
	InsertChecklistTemplateInput,
	InsertChecklistTemplateItemInput,
	UpdateChecklistTemplateInput,
	UpsertChecklistLogInput,
} from './types';

// Templates
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

// Template items
export async function findTemplateItems(templateId: number, tenantId: string) {
	return getRepos().checklist.findTemplateItems(templateId, tenantId);
}
export async function insertTemplateItem(
	input: InsertChecklistTemplateItemInput,
	tenantId: string,
) {
	return getRepos().checklist.insertTemplateItem(input, tenantId);
}
export async function deleteTemplateItem(id: number, tenantId: string) {
	return getRepos().checklist.deleteTemplateItem(id, tenantId);
}

// Logs
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

// Overrides
export async function findOverrides(childId: number, date: string, tenantId: string) {
	return getRepos().checklist.findOverrides(childId, date, tenantId);
}
export async function insertOverride(input: InsertChecklistOverrideInput, tenantId: string) {
	return getRepos().checklist.insertOverride(input, tenantId);
}
export async function deleteOverride(id: number, tenantId: string) {
	return getRepos().checklist.deleteOverride(id, tenantId);
}

// #783: archive / restore
export async function archiveChecklistTemplates(ids: number[], reason: string, tenantId: string) {
	return getRepos().checklist.archiveChecklistTemplates(ids, reason, tenantId);
}
export async function restoreArchivedChecklistTemplates(reason: string, tenantId: string) {
	return getRepos().checklist.restoreArchivedChecklistTemplates(reason, tenantId);
}
