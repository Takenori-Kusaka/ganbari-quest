// src/lib/server/db/dsql/sibling-cheer-repo.ts
//
// ISiblingCheerRepo の DSQL backend 実装。
// #4691: きょうだい間おうえんは機能撤去済 (送信 action / service / 受信 overlay を撤去)。
// 既存行を退会・データ削除で消すための tenant scope 削除だけを残す (§P9 tenant 述語必須)。

import { sql } from 'drizzle-orm';
import type { ISiblingCheerRepo } from '../interfaces/sibling-cheer-repo.interface';
import type { SqlExecutor } from './sql-executor';

/** DSQL 用 ISiblingCheerRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlSiblingCheerRepo(db: SqlExecutor): ISiblingCheerRepo {
	return {
		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM sibling_cheers WHERE family_id = ${tenantId}`);
		},
	};
}
