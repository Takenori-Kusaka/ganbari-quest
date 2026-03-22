// src/lib/server/db/title-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';

export async function findAllTitles() {
	return getRepos().title.findAllTitles();
}
export async function findTitleById(id: number) {
	return getRepos().title.findTitleById(id);
}
export async function findUnlockedTitles(childId: number) {
	return getRepos().title.findUnlockedTitles(childId);
}
export async function isTitleUnlocked(childId: number, titleId: number) {
	return getRepos().title.isTitleUnlocked(childId, titleId);
}
export async function insertChildTitle(childId: number, titleId: number) {
	return getRepos().title.insertChildTitle(childId, titleId);
}
export async function getActiveTitleId(childId: number) {
	return getRepos().title.getActiveTitleId(childId);
}
export async function setActiveTitleId(childId: number, titleId: number | null) {
	return getRepos().title.setActiveTitleId(childId, titleId);
}
