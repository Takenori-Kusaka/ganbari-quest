// Demo IPointRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { DEMO_CHILDREN, DEMO_POINT_BALANCES } from '$lib/server/demo/demo-data';
import type { Child, InsertPointLedgerInput, PointLedgerEntry } from '../types';

export async function getBalance(childId: number, _tenantId: string): Promise<number> {
	return DEMO_POINT_BALANCES[childId] ?? 0;
}

export async function findPointHistory(
	_childId: number,
	_options: { limit: number; offset: number },
	_tenantId: string,
): Promise<PointLedgerEntry[]> {
	return [];
}

export async function insertPointEntry(
	input: InsertPointLedgerInput,
	_tenantId: string,
): Promise<PointLedgerEntry> {
	return {
		id: 0,
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
	childId: number,
	amount: number,
	entry: { type: string; description: string; referenceId?: number },
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

export async function findChildById(id: number, _tenantId: string): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === id);
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function deletePointLedgerBeforeDate(
	_childId: number,
	_cutoffDate: string,
	_tenantId: string,
): Promise<number> {
	return 0;
}
