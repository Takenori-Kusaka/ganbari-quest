// src/lib/server/db/child-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertChildInput, UpdateChildInput } from './types';

export async function findAllChildren(tenantId: string) {
	return getRepos().child.findAllChildren(tenantId);
}
export async function findChildById(id: number, tenantId: string) {
	return getRepos().child.findChildById(id, tenantId);
}
export async function findChildByUserId(userId: string, tenantId: string) {
	return getRepos().child.findChildByUserId(userId, tenantId);
}
export async function insertChild(input: InsertChildInput, tenantId: string) {
	return getRepos().child.insertChild(input, tenantId);
}
export async function updateChild(id: number, input: UpdateChildInput, tenantId: string) {
	return getRepos().child.updateChild(id, input, tenantId);
}
export async function deleteChild(id: number, tenantId: string) {
	return getRepos().child.deleteChild(id, tenantId);
}
