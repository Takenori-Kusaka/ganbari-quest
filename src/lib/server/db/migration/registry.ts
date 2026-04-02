// src/lib/server/db/migration/registry.ts
// SchemaRegistry — エンティティ別バージョン管理とPipeline初期化

import { MigrationPipeline } from './pipeline';
import { childTransformers } from './transformers/child';
import { statusTransformers } from './transformers/status';

/** エンティティバージョン定義 */
const ENTITY_VERSIONS = {
	child: { latest: 2, min: 1 },
	status: { latest: 2, min: 1 },
} as const;

/**
 * 全エンティティの Transformer を登録済みの Pipeline を構築
 */
export function createPipeline(): MigrationPipeline {
	const pipeline = new MigrationPipeline();

	// エンティティバージョン登録
	for (const [entityType, config] of Object.entries(ENTITY_VERSIONS)) {
		pipeline.registerEntity(entityType, config.latest, config.min);
	}

	// Transformer 登録
	for (const t of childTransformers) pipeline.registerTransformer(t);
	for (const t of statusTransformers) pipeline.registerTransformer(t);

	return pipeline;
}

/** エンティティバージョン定数を外部参照用にエクスポート */
export { ENTITY_VERSIONS };
