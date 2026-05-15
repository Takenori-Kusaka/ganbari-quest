// Demo ISiblingCheerRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { InsertSiblingCheerInput, SiblingCheer } from '../types';

export async function insertCheer(
	input: InsertSiblingCheerInput,
	tenantId: string,
): Promise<SiblingCheer> {
	return {
		id: 0,
		fromChildId: input.fromChildId,
		toChildId: input.toChildId,
		stampCode: input.stampCode,
		tenantId,
		sentAt: new Date().toISOString(),
		shownAt: null,
	};
}

export async function findUnshownCheers(
	_toChildId: number,
	_tenantId: string,
): Promise<SiblingCheer[]> {
	return [];
}

export async function markShown(_cheerIds: number[], _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function countTodayCheersFrom(
	_fromChildId: number,
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
