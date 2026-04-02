// src/lib/server/db/migration/transformers/status.ts
// Status エンティティのスキーマ変換器
//
// V1: _sv なし（既存の全レコード）
// V2: peakXp のデフォルト保証（peakXp 未設定 → totalXp をコピー）

import { SCHEMA_VERSION_FIELD, type SchemaTransformer } from '../types';

/**
 * V1→V2: peakXp フィールドのデフォルト保証
 *
 * 背景: peakXp は後から追加されたフィールドで、初期レコードでは 0 のまま。
 * V2 では peakXp が 0 かつ totalXp > 0 の場合、totalXp を peakXp にコピーする。
 */
export const statusV1toV2: SchemaTransformer = {
	entityType: 'status',
	fromVersion: 1,
	toVersion: 2,
	transform(raw) {
		const totalXp = typeof raw.totalXp === 'number' ? raw.totalXp : 0;
		const peakXp = typeof raw.peakXp === 'number' ? raw.peakXp : 0;

		return {
			...raw,
			[SCHEMA_VERSION_FIELD]: 2,
			totalXp,
			level: typeof raw.level === 'number' ? raw.level : 1,
			peakXp: peakXp === 0 && totalXp > 0 ? totalXp : peakXp,
		};
	},
};

export const statusTransformers: SchemaTransformer[] = [statusV1toV2];
