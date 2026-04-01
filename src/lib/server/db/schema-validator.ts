// src/lib/server/db/schema-validator.ts
// Drizzle スキーマと実 DB の差分を検出し、安全なカラム追加を自動実行する

import type Database from 'better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

export interface SchemaValidationResult {
	valid: boolean;
	missingTables: string[];
	missingColumns: Array<{ table: string; column: string; safe: boolean }>;
	extraColumns: Array<{ table: string; column: string }>;
	applied: Array<{ table: string; column: string; sql: string }>;
	errors: string[];
	warnings: string[];
}

// 起動時のバリデーション結果をキャッシュ
let cachedResult: SchemaValidationResult | null = null;

export function getLastValidationResult(): SchemaValidationResult | null {
	return cachedResult;
}

interface PragmaColumn {
	cid: number;
	name: string;
	type: string;
	notnull: number;
	dflt_value: string | null;
	pk: number;
}

/** Drizzle スキーマからテーブル定義を抽出 */
function getExpectedTables(): Map<
	string,
	Map<string, { notNull: boolean; hasDefault: boolean; sqlType: string }>
> {
	const tables = new Map<
		string,
		Map<string, { notNull: boolean; hasDefault: boolean; sqlType: string }>
	>();

	for (const [, value] of Object.entries(schema)) {
		if (!value || typeof value !== 'object') continue;
		try {
			const config = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
			if (!config?.name || !config?.columns) continue;

			const cols = new Map<string, { notNull: boolean; hasDefault: boolean; sqlType: string }>();
			for (const col of config.columns) {
				const sqlType = col.columnType === 'SQLiteInteger' ? 'INTEGER' : 'TEXT';
				cols.set(col.name, {
					notNull: col.notNull,
					hasDefault: col.hasDefault || col.primary,
					sqlType,
				});
			}
			tables.set(config.name, cols);
		} catch {
			// schema export がテーブルでなければスキップ
		}
	}

	return tables;
}

/** 実 DB のテーブル一覧を取得 */
function getActualTables(db: Database.Database): Set<string> {
	const rows = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
		.all() as Array<{ name: string }>;
	return new Set(rows.map((r) => r.name));
}

/** 実 DB のカラム一覧を取得 */
function getActualColumns(db: Database.Database, tableName: string): Map<string, PragmaColumn> {
	const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as PragmaColumn[];
	const map = new Map<string, PragmaColumn>();
	for (const row of rows) {
		map.set(row.name, row);
	}
	return map;
}

/** スキーマを検証し、安全なマイグレーションを自動適用する */
export function validateAndMigrate(db: Database.Database): SchemaValidationResult {
	const result: SchemaValidationResult = {
		valid: true,
		missingTables: [],
		missingColumns: [],
		extraColumns: [],
		applied: [],
		errors: [],
		warnings: [],
	};

	const expectedTables = getExpectedTables();
	const actualTables = getActualTables(db);

	for (const [tableName, expectedCols] of expectedTables) {
		// テーブル存在チェック
		if (!actualTables.has(tableName)) {
			result.missingTables.push(tableName);
			result.errors.push(
				`テーブル '${tableName}' が DB に存在しません。CREATE TABLE の実行を確認してください。`,
			);
			result.valid = false;
			continue;
		}

		const actualCols = getActualColumns(db, tableName);

		// 不足カラムのチェック
		for (const [colName, colDef] of expectedCols) {
			if (!actualCols.has(colName)) {
				// NOT NULL かつデフォルトなし → 安全に追加不可
				const safe = !colDef.notNull || colDef.hasDefault;
				result.missingColumns.push({ table: tableName, column: colName, safe });

				if (safe) {
					// 安全に ALTER TABLE ADD COLUMN を実行
					const sql = `ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef.sqlType}`;
					try {
						db.exec(sql);
						result.applied.push({ table: tableName, column: colName, sql });
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						result.errors.push(`${tableName}.${colName} の追加に失敗: ${msg}`);
						result.valid = false;
					}
				} else {
					result.errors.push(
						`${tableName}.${colName} は NOT NULL (デフォルトなし) です。ALTER TABLE ADD COLUMN では追加できません。手動マイグレーションが必要です。`,
					);
					result.valid = false;
				}
			}
		}

		// DB にあるがスキーマにないカラム（警告のみ）
		for (const [colName] of actualCols) {
			if (!expectedCols.has(colName)) {
				result.extraColumns.push({ table: tableName, column: colName });
				result.warnings.push(
					`${tableName}.${colName} は DB に存在しますがスキーマ定義にありません（レガシーカラム）`,
				);
			}
		}
	}

	cachedResult = result;
	return result;
}
