// src/lib/server/db/sqlite/sibling-cheer-repo.ts
// #4691: きょうだい間おうえんは機能撤去済。退会・データ削除のための行削除のみを提供する。

import { db } from '../client';
import { siblingCheers } from '../schema';

/** テナントの全おうえんスタンプを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(siblingCheers).run();
}
