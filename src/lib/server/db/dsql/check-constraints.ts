// src/lib/server/db/dsql/check-constraints.ts
// EPIC #3424 / 実装 #3512 / 設計 SSOT: docs/design/dsql-data-model.md §11.1 / §13.1(fitness#13)
//
// enum CHECK 制約を domain SSOT から生成する共有 helper (手書き二重化禁止)。
// children の theme/ui_mode/archived_reason CHECK は本 helper 経由で
// age-tier-types.ts / labels.ts / archive-types.ts の SSOT から生成する。
// pg/sqlite 両 backend が本 helper + 同一 SSOT を共有するため CHECK 文字列は一致する
// (dialect-parity、fitness#13)。SSOT に値を足せば全 backend の CHECK に自動反映。

import { type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { THEME_LABELS } from '$lib/domain/labels';

// theme の SSOT = THEME_LABELS のキー (§2 カラートークン / labels.ts)。
export const THEME_KEYS = Object.keys(THEME_LABELS) as (keyof typeof THEME_LABELS)[];

// SSOT 配列から `col IN ('a', 'b', ...)` の CHECK 式を生成する。
// 値のシングルクォートは '' にエスケープ。nullable 列は NULL が CHECK を通過する (SQL 標準)。
export function enumCheck(column: AnyPgColumn, values: readonly string[]): SQL {
	const inList = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
	return sql`${column} IN (${sql.raw(inList)})`;
}
