// src/lib/server/db/title-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function findAllTitles(tenantId: string) {
	return getRepos().title.findAllTitles(tenantId);
}
export async function findTitleById(id: number, tenantId: string) {
	return getRepos().title.findTitleById(id, tenantId);
}
export async function findUnlockedTitles(childId: number, tenantId: string) {
	return getRepos().title.findUnlockedTitles(childId, tenantId);
}
export async function isTitleUnlocked(childId: number, titleId: number, tenantId: string) {
	return getRepos().title.isTitleUnlocked(childId, titleId, tenantId);
}
export async function insertChildTitle(childId: number, titleId: number, tenantId: string) {
	return getRepos().title.insertChildTitle(childId, titleId, tenantId);
}
export async function getActiveTitleId(childId: number, tenantId: string) {
	return getRepos().title.getActiveTitleId(childId, tenantId);
}
export async function setActiveTitleId(childId: number, titleId: number | null, tenantId: string) {
	return getRepos().title.setActiveTitleId(childId, titleId, tenantId);
}
