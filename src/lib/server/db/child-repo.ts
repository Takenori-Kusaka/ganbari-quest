// src/lib/server/db/child-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertChildInput, UpdateChildInput } from './types';

export async function findAllChildren() {
	return getRepos().child.findAllChildren();
}
export async function findChildById(id: number) {
	return getRepos().child.findChildById(id);
}
export async function insertChild(input: InsertChildInput) {
	return getRepos().child.insertChild(input);
}
export async function updateChild(id: number, input: UpdateChildInput) {
	return getRepos().child.updateChild(id, input);
}
export async function deleteChild(id: number) {
	return getRepos().child.deleteChild(id);
}
