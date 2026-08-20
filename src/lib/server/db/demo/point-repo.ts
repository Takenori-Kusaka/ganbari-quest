import type { ChildId } from '$lib/domain/ids';
// Demo IPointRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { DEMO_CHILDREN, DEMO_POINT_BALANCES } from '$lib/server/demo/demo-data';
import type { Child, InsertPointLedgerInput, PointLedgerEntry } from '../types';

export async function getBalance(childId: ChildId, _tenantId: string): Promise<number> {
	return DEMO_POINT_BALANCES[childId] ?? 0;
}

export async function findPointHistory(
	_childId: ChildId,
	_options: { limit: number; offset: number },
	_tenantId: string,
): Promise<PointLedgerEntry[]> {
	return [];
}

/** #4682 F2: demo は stateless Fake のため空配列 (findPointHistory と同挙動)。 */
export async function findPointHistoryByType(
	_childId: ChildId,
	_options: { type: string; limit: number; offset?: number },
	_tenantId: string,
): Promise<PointLedgerEntry[]> {
	return [];
}

/** #4682 F2: demo は台帳を持たないため 0 (件数偽装をしない、#2263 class)。 */
export async function sumPointsByType(
	_childId: ChildId,
	_options: { type: string; fromIso?: string; toIso?: string },
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function insertPointEntry(
	input: InsertPointLedgerInput,
	_tenantId: string,
): Promise<PointLedgerEntry> {
	return {
		id: '0',
		childId: input.childId,
		amount: input.amount,
		type: input.type,
		description: input.description,
		referenceId: input.referenceId ?? null,
		createdAt: new Date().toISOString(),
	};
}

/**
 * #3347: demo backend は stateless fixture（write = no-op stub）のため永続的な二重減算は
 * 起こり得ないが、本番と同一の契約（残高不足は弾く）を満たすため残高確認 → 非負時のみ stub
 * エントリを返す。await を挟まない単一同期チェックで本番の原子性に意味的に一致させる。
 */
export async function spendPointsAtomic(
	childId: ChildId,
	amount: number,
	entry: { type: string; description: string; referenceId?: string },
	tenantId: string,
): Promise<PointLedgerEntry | { error: 'INSUFFICIENT_POINTS' }> {
	const balance = await getBalance(childId, tenantId);
	if (balance < amount) return { error: 'INSUFFICIENT_POINTS' };
	return insertPointEntry(
		{
			childId,
			amount: -amount,
			type: entry.type,
			description: entry.description,
			referenceId: entry.referenceId,
		},
		tenantId,
	);
}

export async function findChildById(id: ChildId, _tenantId: string): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === id);
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function deletePointLedgerBeforeDate(
	_childId: ChildId,
	_cutoffDate: string,
	_tenantId: string,
): Promise<number> {
	return 0;
}
