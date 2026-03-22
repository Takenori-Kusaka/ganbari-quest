// src/lib/server/db/point-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertPointLedgerInput } from './types';

export async function getBalance(childId: number) {
	return getRepos().point.getBalance(childId);
}
export async function findPointHistory(
	childId: number,
	options: { limit: number; offset: number },
) {
	return getRepos().point.findPointHistory(childId, options);
}
export async function insertPointEntry(input: InsertPointLedgerInput) {
	return getRepos().point.insertPointEntry(input);
}
export async function findChildById(id: number) {
	return getRepos().point.findChildById(id);
}
