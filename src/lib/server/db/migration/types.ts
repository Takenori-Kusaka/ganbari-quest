// src/lib/server/db/migration/types.ts
// Schema Versioning + Lazy Migration の型定義

/** スキーマバージョンフィールド名 */
export const SCHEMA_VERSION_FIELD = '_sv';

/** レコードの生データ型 */
export type RawRecord = Record<string, unknown>;

/**
 * スキーマ変換器 — V(n) → V(n+1) の純関数
 * 副作用なし・冪等であること
 */
export interface SchemaTransformer {
	readonly entityType: string;
	readonly fromVersion: number;
	readonly toVersion: number;
	/** 旧形式 → 新形式に変換。必ず _sv を toVersion に設定すること */
	transform(raw: RawRecord): RawRecord;
}

/** マイグレーション結果 */
export interface MigrationResult {
	data: RawRecord;
	/** true なら Write-Back が必要 */
	didMigrate: boolean;
	/** 変換前のバージョン */
	fromVersion: number;
	/** 変換後のバージョン */
	toVersion: number;
}

/** マイグレーションエラー */
export class MigrationError extends Error {
	constructor(
		message: string,
		public readonly entityType: string,
		public readonly recordVersion: number,
	) {
		super(message);
		this.name = 'MigrationError';
	}
}
