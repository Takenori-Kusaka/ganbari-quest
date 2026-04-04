// src/lib/server/services/migration-batch-service.ts
// Eager Batch Migration + 統計サービス

import { eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { ENTITY_VERSIONS, hydrate } from '$lib/server/db/migration';
import { SCHEMA_VERSION_FIELD } from '$lib/server/db/migration/types';
import { children, statuses } from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';

/** エンティティ→テーブルのマッピング */
const ENTITY_TABLE_MAP = {
	child: children,
	status: statuses,
} as const;

type EntityType = keyof typeof ENTITY_TABLE_MAP;

/** バージョン分布エントリ */
interface VersionDistribution {
	version: number | null;
	count: number;
}

/** エンティティ統計 */
interface EntityStats {
	entityType: string;
	latestVersion: number;
	totalRecords: number;
	upToDate: number;
	needsMigration: number;
	distribution: VersionDistribution[];
}

/** バッチマイグレーション結果 */
interface BatchMigrationResult {
	entityType: string;
	scanned: number;
	migrated: number;
	failed: number;
	errors: string[];
}

/**
 * 全エンティティのバージョン分布統計を取得
 */
export function getMigrationStats(): EntityStats[] {
	const results: EntityStats[] = [];

	for (const [entityType, config] of Object.entries(ENTITY_VERSIONS)) {
		const table = ENTITY_TABLE_MAP[entityType as EntityType];
		if (!table) continue;

		// バージョン分布を集計
		const rows = db
			.select({
				version: table._sv,
				count: sql<number>`count(*)`,
			})
			.from(table)
			.groupBy(table._sv)
			.all();

		let totalRecords = 0;
		let upToDate = 0;
		const distribution: VersionDistribution[] = [];

		for (const row of rows) {
			totalRecords += row.count;
			const effectiveVersion = row.version ?? 1;
			if (effectiveVersion >= config.latest) {
				upToDate += row.count;
			}
			distribution.push({ version: row.version, count: row.count });
		}

		// バージョン順にソート (null=1として)
		distribution.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));

		results.push({
			entityType,
			latestVersion: config.latest,
			totalRecords,
			upToDate,
			needsMigration: totalRecords - upToDate,
			distribution,
		});
	}

	return results;
}

/**
 * 指定エンティティの旧バージョンレコードをバッチマイグレーション
 */
export function runBatchMigration(
	entityType: EntityType,
	options: { limit?: number; dryRun?: boolean } = {},
): BatchMigrationResult {
	const { limit = 500, dryRun = false } = options;
	const table = ENTITY_TABLE_MAP[entityType];
	const latestVersion = ENTITY_VERSIONS[entityType].latest;

	// _sv が NULL または最新未満のレコードを取得
	const staleRows = db
		.select()
		.from(table)
		.where(or(isNull(table._sv), lt(table._sv, latestVersion)))
		.limit(limit)
		.all();

	const result: BatchMigrationResult = {
		entityType,
		scanned: staleRows.length,
		migrated: 0,
		failed: 0,
		errors: [],
	};

	if (dryRun || staleRows.length === 0) return result;

	for (const row of staleRows) {
		try {
			const migrationResult = hydrate(entityType, row as Record<string, unknown>);
			if (!migrationResult.didMigrate) continue;

			// SQLite: 直接 _sv を更新 + 変更されたフィールドを反映
			const migrated = migrationResult.data;
			const id = row.id as number;

			if (entityType === 'child') {
				db.update(children)
					.set({
						_sv: migrated[SCHEMA_VERSION_FIELD] as number,
						displayConfig: migrated.displayConfig as string | null,
						birthdayBonusMultiplier: migrated.birthdayBonusMultiplier as number,
						lastBirthdayBonusYear: migrated.lastBirthdayBonusYear as number | null,
						birthDate: migrated.birthDate as string | null,
						avatarUrl: migrated.avatarUrl as string | null,
						userId: migrated.userId as string | null,
					})
					.where(eq(children.id, id))
					.run();
			} else if (entityType === 'status') {
				db.update(statuses)
					.set({
						_sv: migrated[SCHEMA_VERSION_FIELD] as number,
						totalXp: migrated.totalXp as number,
						level: migrated.level as number,
						peakXp: migrated.peakXp as number,
					})
					.where(eq(statuses.id, id))
					.run();
			}

			result.migrated++;
		} catch (err) {
			result.failed++;
			result.errors.push(`id=${row.id}: ${String(err)}`);
			logger.warn('[batch-migration] Record migration failed', {
				error: String(err),
				context: { entityType, recordId: row.id },
			});
		}
	}

	logger.info('[batch-migration] Batch completed', {
		context: { ...result },
	});

	return result;
}

/**
 * 全エンティティのバッチマイグレーションを実行
 */
export function runAllBatchMigrations(
	options: { limit?: number; dryRun?: boolean } = {},
): BatchMigrationResult[] {
	const entityTypes = Object.keys(ENTITY_TABLE_MAP) as EntityType[];
	return entityTypes.map((entityType) => runBatchMigration(entityType, options));
}
