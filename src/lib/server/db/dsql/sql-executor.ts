// src/lib/server/db/dsql/sql-executor.ts
// EPIC #3424 / 設計 SSOT: dsql-data-model.md §8
//
// drizzle pg db / tx が構造的に満たす最小 SQL 実行面。tx 必須引数 (fitness#8) を
// 受ける関数群 (invite-accept / derived-drift 等) が driver 非依存で共有する。

import type { SQL } from 'drizzle-orm';

export interface SqlExecutor {
	execute(query: SQL): Promise<{ rows: unknown[] }>;
}
