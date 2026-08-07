import type { ChildId } from '$lib/domain/ids';
// src/lib/server/db/sibling-cheer-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertSiblingCheerInput, SiblingCheer } from './types';

export async function insertCheer(
	input: InsertSiblingCheerInput,
	tenantId: string,
): Promise<SiblingCheer> {
	return getRepos().siblingCheer.insertCheer(input, tenantId);
}

export async function findUnshownCheers(
	toChildId: ChildId,
	tenantId: string,
): Promise<SiblingCheer[]> {
	return getRepos().siblingCheer.findUnshownCheers(toChildId, tenantId);
}

export async function markShown(
	toChildId: ChildId,
	cheerIds: string[],
	tenantId: string,
): Promise<void> {
	return getRepos().siblingCheer.markShown(toChildId, cheerIds, tenantId);
}

export async function countTodayCheersFrom(
	fromChildId: ChildId,
	tenantId: string,
): Promise<number> {
	return getRepos().siblingCheer.countTodayCheersFrom(fromChildId, tenantId);
}
