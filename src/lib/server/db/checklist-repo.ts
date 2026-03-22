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
export async function findTemplatesByChild(childId: number, includeInactive = false) {
	return getRepos().checklist.findTemplatesByChild(childId, includeInactive);
}
export async function findTemplateById(id: number) {
	return getRepos().checklist.findTemplateById(id);
}
export async function insertTemplate(input: InsertChecklistTemplateInput) {
	return getRepos().checklist.insertTemplate(input);
}
export async function updateTemplate(id: number, input: UpdateChecklistTemplateInput) {
	return getRepos().checklist.updateTemplate(id, input);
}
export async function deleteTemplate(id: number) {
	return getRepos().checklist.deleteTemplate(id);
}

// Template items
export async function findTemplateItems(templateId: number) {
	return getRepos().checklist.findTemplateItems(templateId);
}
export async function insertTemplateItem(input: InsertChecklistTemplateItemInput) {
	return getRepos().checklist.insertTemplateItem(input);
}
export async function deleteTemplateItem(id: number) {
	return getRepos().checklist.deleteTemplateItem(id);
}

// Logs
export async function findTodayLog(childId: number, templateId: number, date: string) {
	return getRepos().checklist.findTodayLog(childId, templateId, date);
}
export async function upsertLog(input: UpsertChecklistLogInput) {
	return getRepos().checklist.upsertLog(input);
}

// Overrides
export async function findOverrides(childId: number, date: string) {
	return getRepos().checklist.findOverrides(childId, date);
}
export async function insertOverride(input: InsertChecklistOverrideInput) {
	return getRepos().checklist.insertOverride(input);
}
export async function deleteOverride(id: number) {
	return getRepos().checklist.deleteOverride(id);
}
