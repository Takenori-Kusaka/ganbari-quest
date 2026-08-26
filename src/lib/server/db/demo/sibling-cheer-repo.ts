// src/lib/server/db/demo/sibling-cheer-repo.ts
// Demo ISiblingCheerRepo implementation
// #4691: きょうだい間おうえんは機能撤去済。demo は書き込み / 削除とも no-op。

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
