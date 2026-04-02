// src/lib/server/db/migration/pipeline.ts
// MigrationPipeline — エンティティをレコード読み取り時に最新バージョンへ変換

import {
	MigrationError,
	type MigrationResult,
	type RawRecord,
	SCHEMA_VERSION_FIELD,
	type SchemaTransformer,
} from './types';

export class MigrationPipeline {
	/** entityType → (fromVersion → transformer) */
	private chains = new Map<string, Map<number, SchemaTransformer>>();
	/** entityType → 最新バージョン */
	private latestVersions = new Map<string, number>();
	/** entityType → 最小サポートバージョン */
	private minVersions = new Map<string, number>();

	/**
	 * エンティティの最新バージョンと最小サポートバージョンを登録
	 */
	registerEntity(entityType: string, latestVersion: number, minVersion = 1): void {
		this.latestVersions.set(entityType, latestVersion);
		this.minVersions.set(entityType, minVersion);
	}

	/**
	 * Transformer を登録
	 */
	registerTransformer(transformer: SchemaTransformer): void {
		if (!this.chains.has(transformer.entityType)) {
			this.chains.set(transformer.entityType, new Map());
		}
		const chain = this.chains.get(transformer.entityType);
		chain?.set(transformer.fromVersion, transformer);
	}

	/**
	 * レコードを最新バージョンに変換
	 * @returns MigrationResult — didMigrate=true なら Write-Back 必要
	 */
	migrateToLatest(entityType: string, raw: RawRecord): MigrationResult {
		const version = (raw[SCHEMA_VERSION_FIELD] as number) ?? 1;
		const latest = this.latestVersions.get(entityType) ?? 1;

		if (version >= latest) {
			return { data: raw, didMigrate: false, fromVersion: version, toVersion: version };
		}

		const min = this.minVersions.get(entityType) ?? 1;
		if (version < min) {
			throw new MigrationError(
				`${entityType} v${version} は最小サポート v${min} 未満です。バッチマイグレーションを実行してください。`,
				entityType,
				version,
			);
		}

		let current = { ...raw };
		let currentVersion = version;

		while (currentVersion < latest) {
			const transformer = this.chains.get(entityType)?.get(currentVersion);
			if (!transformer) {
				throw new MigrationError(
					`${entityType} v${currentVersion} → v${currentVersion + 1} の Transformer がありません`,
					entityType,
					currentVersion,
				);
			}
			current = transformer.transform(current);
			currentVersion = (current[SCHEMA_VERSION_FIELD] as number) ?? currentVersion + 1;
		}

		return { data: current, didMigrate: true, fromVersion: version, toVersion: currentVersion };
	}

	/**
	 * 新規レコードに最新バージョンを付与
	 */
	withLatestVersion(entityType: string, data: RawRecord): RawRecord {
		const latest = this.latestVersions.get(entityType) ?? 1;
		return { ...data, [SCHEMA_VERSION_FIELD]: latest };
	}

	/** 登録済みエンティティの最新バージョンを取得 */
	getLatestVersion(entityType: string): number {
		return this.latestVersions.get(entityType) ?? 1;
	}

	/** 登録済みエンティティ一覧 */
	getRegisteredEntities(): string[] {
		return [...this.latestVersions.keys()];
	}
}
