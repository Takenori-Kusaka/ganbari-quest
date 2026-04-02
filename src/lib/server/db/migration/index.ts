// src/lib/server/db/migration/index.ts
// Public API for Schema Versioning + Lazy Migration

import { createPipeline } from './registry';

export type { MigrationResult, RawRecord, SchemaTransformer } from './types';
export { MigrationError, SCHEMA_VERSION_FIELD } from './types';
export { MigrationPipeline } from './pipeline';
export { ENTITY_VERSIONS } from './registry';

/** アプリケーション全体で共有するシングルトン Pipeline */
let _pipeline: ReturnType<typeof createPipeline> | null = null;

export function getPipeline(): ReturnType<typeof createPipeline> {
	if (!_pipeline) {
		_pipeline = createPipeline();
	}
	return _pipeline;
}

/**
 * レコードを最新バージョンに hydrate（読み取り時に使用）
 */
export function hydrate(entityType: string, raw: Record<string, unknown>) {
	return getPipeline().migrateToLatest(entityType, raw);
}

/**
 * 新規レコードに最新バージョンを付与（書き込み時に使用）
 */
export function withVersion(entityType: string, data: Record<string, unknown>) {
	return getPipeline().withLatestVersion(entityType, data);
}
