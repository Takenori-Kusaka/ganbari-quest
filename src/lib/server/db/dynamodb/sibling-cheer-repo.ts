import type { InsertSiblingCheerInput, SiblingCheer } from '../types';

const NOT_IMPL = 'DynamoDB sibling-cheer-repo not implemented';

export async function insertCheer(
	_input: InsertSiblingCheerInput,
	_tenantId: string,
): Promise<SiblingCheer> {
	throw new Error(NOT_IMPL);
}

export async function findUnshownCheers(
	_toChildId: number,
	_tenantId: string,
): Promise<SiblingCheer[]> {
	throw new Error(NOT_IMPL);
}

export async function markShown(_cheerIds: number[], _tenantId: string): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function countTodayCheersFrom(
	_fromChildId: number,
	_tenantId: string,
): Promise<number> {
	throw new Error(NOT_IMPL);
}

/** テナントの全おうえんスタンプを削除（DynamoDB未実装: 書き込みがないため no-op） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// DynamoDB sibling-cheer repo は未実装のため書き込みデータなし — no-op
}
