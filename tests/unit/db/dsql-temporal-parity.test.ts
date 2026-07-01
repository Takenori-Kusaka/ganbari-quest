// tests/unit/db/dsql-temporal-parity.test.ts
// EPIC #3424 / 実装 #3512 (#N0-1) / 設計 SSOT: docs/design/dsql-data-model.md §11.3 / §13.1(fitness#6)
//
// fitness#6「dialect-parity: temporal {mode:'string'} を両 backend で assert」:
//   §11.3 変換規則は「全 temporal は {mode:'string'} 固定」— pg が Date を返すと
//   SQLite[string] と型 drift + backup verbatim 破壊 (SQLite parity Finding 6)。
//   drizzle では mode 省略時の既定が Date mode (dataType='date') のため、
//   表追記時に {mode:'string'} を書き忘れるだけで silent drift する → CI で機械強制。
//
//   検査は schema module の全 export 表を走査する（children 固定列挙にしない）ため、
//   Phase B/C で表を追記しても本テストの変更なしで自動カバーされる。
//
// ── Canon TDD test list ──
//   [1] pg: dsql/schema.ts 全表の temporal 列 (PgTimestamp*/PgDate*) が dataType='string'
//   [2] pg: timestamp 列は全て withTimezone=true (§11.3 timestamptz↔text(ISO))
//   [3] sqlite: pg schema と同名の表に Date-mode 列 (dataType='date') が無い
//   red 確認は mutation（children の {mode:'string'} を外す）で drift 検出を実証済。

import { getTableName, is } from 'drizzle-orm';
import { PgTable, getTableConfig as pgTableConfig } from 'drizzle-orm/pg-core';
import { SQLiteTable, getTableConfig as sqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as dsqlSchema from '../../../src/lib/server/db/dsql/schema';
import * as sqliteSchema from '../../../src/lib/server/db/schema';

/** dsql/schema.ts の全 pg 表（export 走査、表追記で自動拡張） */
const pgTables = Object.values(dsqlSchema).filter((v): v is PgTable => is(v, PgTable));

/** pg temporal 列 = timestamp / date 系 columnType（mode により *String suffix が付く） */
const isPgTemporal = (columnType: string) =>
	columnType.startsWith('PgTimestamp') || columnType.startsWith('PgDate');

describe('fitness#6: temporal dialect-parity (§11.3 / SQLite parity Finding 6)', () => {
	it('dsql schema に pg 表が最低 1 つ存在する（走査の空振り防止）', () => {
		expect(pgTables.length).toBeGreaterThan(0);
	});

	it('[1] pg: 全 temporal 列が {mode:"string"} (dataType="string"、Date mode 禁止)', () => {
		const violations: string[] = [];
		let temporalCount = 0;
		for (const table of pgTables) {
			const cfg = pgTableConfig(table);
			for (const col of cfg.columns) {
				if (!isPgTemporal(col.columnType)) continue;
				temporalCount++;
				if (col.dataType !== 'string') {
					violations.push(`${cfg.name}.${col.name} (columnType=${col.columnType})`);
				}
			}
		}
		// created_at/updated_at を持つ children が既に居るため 0 件は走査バグ（vacuous pass 防止）
		expect(temporalCount).toBeGreaterThan(0);
		expect(violations, 'temporal 列は {mode:"string"} 必須 (§11.3)').toEqual([]);
	});

	it('[2] pg: timestamp 列は全て withTimezone=true (timestamptz、§11.3)', () => {
		const violations: string[] = [];
		for (const table of pgTables) {
			const cfg = pgTableConfig(table);
			for (const col of cfg.columns) {
				if (!col.columnType.startsWith('PgTimestamp')) continue;
				// PgTimestamp / PgTimestampString は withTimezone プロパティを持つ
				const withTz = (col as unknown as { withTimezone?: boolean }).withTimezone;
				if (withTz !== true) {
					violations.push(`${cfg.name}.${col.name}`);
				}
			}
		}
		expect(violations, 'timestamp は timestamptz 固定 (§11.3)').toEqual([]);
	});

	it('[3] sqlite: pg schema と同名の表に Date-mode 列が無い（両 backend 共に string）', () => {
		const pgTableNames = new Set(pgTables.map((t) => getTableName(t)));
		const sqliteTables = Object.values(sqliteSchema).filter((v): v is SQLiteTable =>
			is(v, SQLiteTable),
		);
		const paired = sqliteTables.filter((t) => pgTableNames.has(getTableName(t)));
		// pg 側に children が居る以上、sqlite 側にも同名表が居るはず（parity pair の空振り防止）
		expect(paired.length).toBeGreaterThan(0);

		const violations: string[] = [];
		for (const table of paired) {
			const cfg = sqliteTableConfig(table);
			for (const col of cfg.columns) {
				if (col.dataType === 'date') {
					violations.push(`${cfg.name}.${col.name} (columnType=${col.columnType})`);
				}
			}
		}
		expect(violations, 'sqlite 側も temporal は string（integer timestamp mode 禁止）').toEqual([]);
	});
});
