// tests/unit/migration/pipeline.test.ts
// MigrationPipeline のユニットテスト

import { describe, expect, it } from 'vitest';
import { MigrationPipeline } from '../../../src/lib/server/db/migration/pipeline';
import type { SchemaTransformer } from '../../../src/lib/server/db/migration/types';
import { MigrationError, SCHEMA_VERSION_FIELD } from '../../../src/lib/server/db/migration/types';

// テスト用 Transformer
const testV1toV2: SchemaTransformer = {
	entityType: 'test',
	fromVersion: 1,
	toVersion: 2,
	transform(raw) {
		return { ...raw, [SCHEMA_VERSION_FIELD]: 2, newField: raw.newField ?? 'default' };
	},
};

const testV2toV3: SchemaTransformer = {
	entityType: 'test',
	fromVersion: 2,
	toVersion: 3,
	transform(raw) {
		return {
			...raw,
			[SCHEMA_VERSION_FIELD]: 3,
			renamedField: raw.newField,
		};
	},
};

function createTestPipeline() {
	const p = new MigrationPipeline();
	p.registerEntity('test', 3, 1);
	p.registerTransformer(testV1toV2);
	p.registerTransformer(testV2toV3);
	return p;
}

describe('MigrationPipeline', () => {
	describe('migrateToLatest', () => {
		it('最新バージョンのレコードはそのまま返す', () => {
			const p = createTestPipeline();
			const record = { name: 'test', [SCHEMA_VERSION_FIELD]: 3 };
			const result = p.migrateToLatest('test', record);
			expect(result.didMigrate).toBe(false);
			expect(result.data).toEqual(record);
			expect(result.fromVersion).toBe(3);
			expect(result.toVersion).toBe(3);
		});

		it('_sv なし（V1）のレコードを最新に変換する', () => {
			const p = createTestPipeline();
			const record = { name: 'test' };
			const result = p.migrateToLatest('test', record);
			expect(result.didMigrate).toBe(true);
			expect(result.fromVersion).toBe(1);
			expect(result.toVersion).toBe(3);
			expect(result.data[SCHEMA_VERSION_FIELD]).toBe(3);
			expect(result.data.newField).toBe('default');
			expect(result.data.renamedField).toBe('default');
		});

		it('V2 → V3 の単一ステップ変換', () => {
			const p = createTestPipeline();
			const record = { name: 'test', [SCHEMA_VERSION_FIELD]: 2, newField: 'custom' };
			const result = p.migrateToLatest('test', record);
			expect(result.didMigrate).toBe(true);
			expect(result.fromVersion).toBe(2);
			expect(result.toVersion).toBe(3);
			expect(result.data.renamedField).toBe('custom');
		});

		it('チェーン変換: V1 → V2 → V3', () => {
			const p = createTestPipeline();
			const record = { name: 'test' }; // V1
			const result = p.migrateToLatest('test', record);
			expect(result.data[SCHEMA_VERSION_FIELD]).toBe(3);
			expect(result.data.newField).toBe('default'); // V1→V2 で追加
			expect(result.data.renamedField).toBe('default'); // V2→V3 で追加
		});

		it('元レコードを変更しない（イミュータブル）', () => {
			const p = createTestPipeline();
			const original = { name: 'test' };
			p.migrateToLatest('test', original);
			expect(original).toEqual({ name: 'test' }); // 変更されていない
		});

		it('未登録エンティティは V1 扱いでそのまま返す', () => {
			const p = createTestPipeline();
			const record = { name: 'unknown' };
			const result = p.migrateToLatest('unknown', record);
			expect(result.didMigrate).toBe(false);
		});
	});

	describe('最小バージョンチェック', () => {
		it('最小サポートバージョン未満で MigrationError', () => {
			const p = new MigrationPipeline();
			p.registerEntity('strict', 3, 2); // min=2
			p.registerTransformer({
				entityType: 'strict',
				fromVersion: 2,
				toVersion: 3,
				transform: (raw) => ({ ...raw, [SCHEMA_VERSION_FIELD]: 3 }),
			});

			// V1 は min=2 未満 → エラー
			expect(() => p.migrateToLatest('strict', { name: 'old' })).toThrow(MigrationError);
		});

		it('最小サポートバージョン以上は正常に変換', () => {
			const p = new MigrationPipeline();
			p.registerEntity('strict', 3, 2);
			p.registerTransformer({
				entityType: 'strict',
				fromVersion: 2,
				toVersion: 3,
				transform: (raw) => ({ ...raw, [SCHEMA_VERSION_FIELD]: 3 }),
			});

			const result = p.migrateToLatest('strict', {
				name: 'ok',
				[SCHEMA_VERSION_FIELD]: 2,
			});
			expect(result.didMigrate).toBe(true);
			expect(result.data[SCHEMA_VERSION_FIELD]).toBe(3);
		});
	});

	describe('Transformer 欠落', () => {
		it('チェーンが途切れると MigrationError', () => {
			const p = new MigrationPipeline();
			p.registerEntity('broken', 3, 1);
			// V1→V2 のみ登録、V2→V3 なし
			p.registerTransformer({
				entityType: 'broken',
				fromVersion: 1,
				toVersion: 2,
				transform: (raw) => ({ ...raw, [SCHEMA_VERSION_FIELD]: 2 }),
			});

			expect(() => p.migrateToLatest('broken', { name: 'test' })).toThrow(MigrationError);
		});
	});

	describe('withLatestVersion', () => {
		it('新規レコードに最新バージョンを付与', () => {
			const p = createTestPipeline();
			const data = p.withLatestVersion('test', { name: 'new' });
			expect(data[SCHEMA_VERSION_FIELD]).toBe(3);
			expect(data.name).toBe('new');
		});

		it('未登録エンティティは V1 を付与', () => {
			const p = createTestPipeline();
			const data = p.withLatestVersion('unknown', { name: 'new' });
			expect(data[SCHEMA_VERSION_FIELD]).toBe(1);
		});
	});

	describe('冪等性', () => {
		it('同じレコードを2回変換しても結果が同じ', () => {
			const p = createTestPipeline();
			const record = { name: 'test' };
			const result1 = p.migrateToLatest('test', record);
			const result2 = p.migrateToLatest('test', result1.data);
			expect(result2.didMigrate).toBe(false);
			expect(result2.data).toEqual(result1.data);
		});
	});

	describe('ユーティリティ', () => {
		it('getLatestVersion', () => {
			const p = createTestPipeline();
			expect(p.getLatestVersion('test')).toBe(3);
			expect(p.getLatestVersion('unknown')).toBe(1);
		});

		it('getRegisteredEntities', () => {
			const p = createTestPipeline();
			expect(p.getRegisteredEntities()).toContain('test');
		});
	});
});
