// src/lib/server/db/schema-validator.ts
// Drizzle スキーマと実 DB の差分を検出し、安全なカラム追加を自動実行する
// ADR-0031: ALTER TABLE ADD COLUMN 時に DEFAULT 節付与 + backfill UPDATE を同トランザクションで実行

import type Database from 'better-sqlite3';
import { SQL } from 'drizzle-orm';
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

/** カラム定義の型 */
interface ColumnDef {
	notNull: boolean;
	hasDefault: boolean;
	sqlType: string;
	/** SQL の DEFAULT 節に使う文字列。undefined = DEFAULT なし */
	defaultClause: string | undefined;
	/** backfill UPDATE の SET 値。undefined = backfill 不要 */
	backfillValue: string | undefined;
	/**
	 * true = 定数 DEFAULT (number/string リテラル)。ALTER TABLE ADD COLUMN ... DEFAULT で使用可能。
	 * false = 非定数 DEFAULT (CURRENT_TIMESTAMP 等)。SQLite の ALTER TABLE では使用不可。
	 *   非定数の場合は DEFAULT 節なしで追加し、backfill UPDATE で値を埋める。
	 */
	isConstantDefault: boolean;
}

/**
 * Drizzle column の default プロパティから SQL の DEFAULT 節文字列を抽出する。
 *
 * - 定数リテラル (number/string): そのまま SQL リテラル化 → isConstant=true
 * - SQL オブジェクト (sql`CURRENT_TIMESTAMP` 等): queryChunks から式を抽出 → isConstant=false
 * - primary key (autoincrement): DEFAULT 不要
 * - undefined (default なし): undefined を返す
 *
 * SQLite の ALTER TABLE ADD COLUMN は定数 DEFAULT のみ許容する。
 * CURRENT_TIMESTAMP 等の非定数式は ALTER TABLE の DEFAULT 節には使えないため、
 * backfill UPDATE で値を埋める必要がある。
 */
export function extractDefaultClause(col: {
	default: unknown;
	hasDefault: boolean;
	primary: boolean;
}): { clause: string; isConstant: boolean } | undefined {
	// primary key は DEFAULT 不要（AUTOINCREMENT で管理）
	if (col.primary) return undefined;

	if (!col.hasDefault) return undefined;

	const d = col.default;

	// 定数リテラル: number → そのまま, string → シングルクォート
	if (typeof d === 'number') return { clause: String(d), isConstant: true };
	if (typeof d === 'string') return { clause: `'${d.replace(/'/g, "''")}'`, isConstant: true };

	// SQL 式 (sql`CURRENT_TIMESTAMP` 等) — 非定数
	if (d instanceof SQL) {
		const chunks = (d as unknown as { queryChunks: Array<{ value: string[] }> }).queryChunks;
		const firstChunk = chunks?.[0];
		const firstValue = firstChunk?.value?.[0];
		if (firstValue !== undefined) {
			return { clause: firstValue, isConstant: false };
		}
	}

	return undefined;
}

/**
 * DEFAULT 節の値から backfill UPDATE に使う SET 式を導出する。
 *
 * - 定数値 (数値・文字列リテラル): そのまま使用可能
 * - CURRENT_TIMESTAMP 等の非定数 SQL 式: backfill でも同じ式を使う
 * - DEFAULT なし: backfill 不要
 */
export function deriveBackfillValue(defaultClause: string | undefined): string | undefined {
	if (defaultClause === undefined) return undefined;
	return defaultClause;
}

/** Drizzle スキーマからテーブル定義を抽出 */
function getExpectedTables(): Map<string, Map<string, ColumnDef>> {
	const tables = new Map<string, Map<string, ColumnDef>>();

	for (const [, value] of Object.entries(schema)) {
		if (!value || typeof value !== 'object') continue;
		try {
			const config = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
			if (!config?.name || !config?.columns) continue;

			const cols = new Map<string, ColumnDef>();
			for (const col of config.columns) {
				const sqlType =
					col.columnType === 'SQLiteInteger'
						? 'INTEGER'
						: col.columnType === 'SQLiteReal'
							? 'REAL'
							: 'TEXT';
				const extracted = extractDefaultClause(col);
				const defaultClause = extracted?.clause;
				const isConstantDefault = extracted?.isConstant ?? false;
				cols.set(col.name, {
					notNull: col.notNull,
					hasDefault: col.hasDefault || col.primary,
					sqlType,
					defaultClause,
					backfillValue: deriveBackfillValue(defaultClause),
					isConstantDefault,
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
					// ADR-0031: ALTER TABLE + DEFAULT 節 + backfill UPDATE を同トランザクションで実行
					// 注意: SQLite の ALTER TABLE ADD COLUMN は定数 DEFAULT のみ許容する。
					// CURRENT_TIMESTAMP 等の非定数式は DEFAULT 節に含めず、backfill UPDATE で補完する。
					const canUseDefaultInAlter =
						colDef.isConstantDefault && colDef.defaultClause !== undefined;
					const defaultSuffix = canUseDefaultInAlter ? ` DEFAULT ${colDef.defaultClause}` : '';
					// NOT NULL は定数 DEFAULT がある場合のみ付与。非定数の場合は NOT NULL 制約なしで追加し backfill する。
					const notNullSuffix = colDef.notNull && canUseDefaultInAlter ? ' NOT NULL' : '';
					const alterSql = `ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef.sqlType}${notNullSuffix}${defaultSuffix}`;

					try {
						db.exec('BEGIN IMMEDIATE');
						try {
							db.exec(alterSql);

							// backfill: 既存行の NULL を DEFAULT 値で埋める（ADR-0031 D-1）
							if (colDef.backfillValue !== undefined) {
								const backfillSql = `UPDATE ${tableName} SET ${colName} = ${colDef.backfillValue} WHERE ${colName} IS NULL`;
								db.exec(backfillSql);
								result.applied.push({
									table: tableName,
									column: colName,
									sql: `${alterSql}; ${backfillSql}`,
								});
							} else {
								result.applied.push({ table: tableName, column: colName, sql: alterSql });
							}

							db.exec('COMMIT');
						} catch (e) {
							db.exec('ROLLBACK');
							throw e;
						}
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
