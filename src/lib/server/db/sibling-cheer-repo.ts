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
	toChildId: number,
	tenantId: string,
): Promise<SiblingCheer[]> {
	return getRepos().siblingCheer.findUnshownCheers(toChildId, tenantId);
}

export async function markShown(cheerIds: number[], tenantId: string): Promise<void> {
	return getRepos().siblingCheer.markShown(cheerIds, tenantId);
}

export async function countTodayCheersFrom(fromChildId: number, tenantId: string): Promise<number> {
	return getRepos().siblingCheer.countTodayCheersFrom(fromChildId, tenantId);
}
