import type { ChildId } from '$lib/domain/ids';
// src/lib/server/db/point-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertPointLedgerInput } from './types';

export async function getBalance(childId: ChildId, tenantId: string) {
	return getRepos().point.getBalance(childId, tenantId);
}
export async function findPointHistory(
	childId: ChildId,
	options: { limit: number; offset: number },
	tenantId: string,
) {
	return getRepos().point.findPointHistory(childId, options, tenantId);
}
/** #4682 F2: 種別で絞った台帳一覧 (limit はその種別の表示件数)。 */
export async function findPointHistoryByType(
	childId: ChildId,
	options: { type: string; limit: number; offset?: number },
	tenantId: string,
) {
	return getRepos().point.findPointHistoryByType(childId, options, tenantId);
}
/** #4682 F2: 種別 (+ JST 期間) の SUM を DB 側で計算する (一覧 window 非依存)。 */
export async function sumPointsByType(
	childId: ChildId,
	options: { type: string; fromIso?: string; toIso?: string },
	tenantId: string,
) {
	return getRepos().point.sumPointsByType(childId, options, tenantId);
}
export async function insertPointEntry(input: InsertPointLedgerInput, tenantId: string) {
	return getRepos().point.insertPointEntry(input, tenantId);
}
/**
 * #3347: 残高が `amount` 以上のときのみ原子的に減算 + 台帳挿入する（TOCTOU 二重減算防止）。
 * 詳細は `IPointRepo.spendPointsAtomic` の doc を参照。
 */
export async function spendPointsAtomic(
	childId: ChildId,
	amount: number,
	entry: { type: string; description: string; referenceId?: string },
	tenantId: string,
) {
	return getRepos().point.spendPointsAtomic(childId, amount, entry, tenantId);
}
export async function findChildById(id: ChildId, tenantId: string) {
	return getRepos().point.findChildById(id, tenantId);
}
