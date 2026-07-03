// Demo ISiblingCheerRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
// #2097 Phase B-5b: cheer fixture を返すことで子供画面でのおうえん表示を確認可能化。

import { DEMO_SIBLING_CHEERS } from '$lib/server/demo/demo-data';
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

export async function findAllByTenant(tenantId: string): Promise<SiblingCheer[]> {
	return DEMO_SIBLING_CHEERS.filter((c) => c.tenantId === tenantId).slice();
}

export async function insertForRestore(
	input: Omit<SiblingCheer, 'id' | 'tenantId'>,
	tenantId: string,
): Promise<SiblingCheer> {
	// Stub: demo は書き込み no-op。引数の状態を反映した row を返す。
	return { ...input, id: 0, tenantId };
}

export async function findUnshownCheers(
	toChildId: number,
	_tenantId: string,
): Promise<SiblingCheer[]> {
	// #2097 Phase B-5b: 未表示の cheer を返す (受信側 = toChildId)。
	// fixture は shownAt=null のエントリを含めており、子供画面の SiblingCheerOverlay
	// 等で「エール受信演出」が demo 環境でも確認可能。
	return DEMO_SIBLING_CHEERS.filter((c) => c.toChildId === toChildId && c.shownAt === null);
}

/**
 * 子供別 cheer (受信履歴全件、既読/未読不問) を返す。
 * #2097 Phase B-5b: 「エール表示が空」のバグ修正用。受信側 = toChildId。
 * 履歴 / 統計画面で過去のおうえんも見えるようにするための補助メソッド。
 */
export async function findCheersByChild(
	childId: number,
	_tenantId: string,
): Promise<SiblingCheer[]> {
	return DEMO_SIBLING_CHEERS.filter((c) => c.toChildId === childId);
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
