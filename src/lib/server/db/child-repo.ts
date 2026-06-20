// src/lib/server/db/child-repo.ts — Facade (delegates to factory)

import type { ArchivedReason } from '$lib/domain/archive-types';
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

// #3152: 子供 1 人分の進捗データ (activity_logs / point_ledger / login_bonuses /
// child_achievements) を全削除する (child 行は残す、dev-only デバッグ用途)。
export async function resetChildProgressData(id: number, tenantId: string) {
	return getRepos().child.resetChildProgressData(id, tenantId);
}

// #783: archive / restore
// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
export async function archiveChildren(ids: number[], reason: ArchivedReason, tenantId: string) {
	return getRepos().child.archiveChildren(ids, reason, tenantId);
}
export async function restoreArchivedChildren(reason: ArchivedReason, tenantId: string) {
	return getRepos().child.restoreArchivedChildren(reason, tenantId);
}
export async function findArchivedChildren(tenantId: string) {
	return getRepos().child.findArchivedChildren(tenantId);
}
