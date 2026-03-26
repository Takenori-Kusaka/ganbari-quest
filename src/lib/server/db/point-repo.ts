// src/lib/server/db/point-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertPointLedgerInput } from './types';

export async function getBalance(childId: number, tenantId: string) {
	return getRepos().point.getBalance(childId, tenantId);
}
export async function findPointHistory(
	childId: number,
	options: { limit: number; offset: number },
	tenantId: string,
) {
	return getRepos().point.findPointHistory(childId, options, tenantId);
}
export async function insertPointEntry(input: InsertPointLedgerInput, tenantId: string) {
	return getRepos().point.insertPointEntry(input, tenantId);
}
export async function findChildById(id: number, tenantId: string) {
	return getRepos().point.findChildById(id, tenantId);
}
