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
/**
 * #3347: 残高が `amount` 以上のときのみ原子的に減算 + 台帳挿入する（TOCTOU 二重減算防止）。
 * 詳細は `IPointRepo.spendPointsAtomic` の doc を参照。
 */
export async function spendPointsAtomic(
	childId: number,
	amount: number,
	entry: { type: string; description: string; referenceId?: number },
	tenantId: string,
) {
	return getRepos().point.spendPointsAtomic(childId, amount, entry, tenantId);
}
export async function findChildById(id: number, tenantId: string) {
	return getRepos().point.findChildById(id, tenantId);
}
