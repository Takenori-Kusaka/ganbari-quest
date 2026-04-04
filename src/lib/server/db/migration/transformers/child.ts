// src/lib/server/db/migration/transformers/child.ts
// Child エンティティのスキーマ変換器
//
// V1: _sv なし（既存の全レコード）
// V2: displayConfig, birthdayBonusMultiplier, lastBirthdayBonusYear のデフォルト保証

import { SCHEMA_VERSION_FIELD, type SchemaTransformer } from '../types';

/**
 * V1→V2: オプショナルフィールドにデフォルト値を保証
 *
 * 背景: スキーマ追加で ALTER TABLE ADD COLUMN は自動化されたが、
 * 既存レコードのフィールド値が null/未定義のまま残るケースがあった。
 * V2 では全フィールドが明示的なデフォルト値を持つことを保証する。
 */
export const childV1toV2: SchemaTransformer = {
	entityType: 'child',
	fromVersion: 1,
	toVersion: 2,
	transform(raw) {
		return {
			...raw,
			[SCHEMA_VERSION_FIELD]: 2,
			displayConfig: raw.displayConfig ?? null,
			birthdayBonusMultiplier:
				typeof raw.birthdayBonusMultiplier === 'number' ? raw.birthdayBonusMultiplier : 1.0,
			lastBirthdayBonusYear:
				typeof raw.lastBirthdayBonusYear === 'number' ? raw.lastBirthdayBonusYear : null,
			birthDate: raw.birthDate ?? null,
			avatarUrl: raw.avatarUrl ?? null,
			userId: raw.userId ?? null,
		};
	},
};

export const childTransformers: SchemaTransformer[] = [childV1toV2];
