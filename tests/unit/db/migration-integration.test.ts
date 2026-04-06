// tests/unit/db/migration-integration.test.ts
// MigrationPipeline のリポジトリ統合テスト

import { describe, expect, it } from 'vitest';
import { ENTITY_VERSIONS, getPipeline, hydrate, withVersion } from '$lib/server/db/migration';
import { SCHEMA_VERSION_FIELD } from '$lib/server/db/migration/types';

describe('MigrationPipeline リポジトリ統合', () => {
	describe('hydrate() — 読み取り時の自動マイグレーション', () => {
		it('child: _sv なしレコードを V2 に変換する', () => {
			const raw = {
				id: 1,
				nickname: 'テスト',
				age: 5,
				theme: 'pink',
				uiMode: 'preschool',
				createdAt: '2024-01-01',
				updatedAt: '2024-01-01',
				// V1: displayConfig, birthdayBonusMultiplier 等が未定義
			};

			const { data, didMigrate } = hydrate('child', raw);

			expect(didMigrate).toBe(true);
			expect(data[SCHEMA_VERSION_FIELD]).toBe(ENTITY_VERSIONS.child.latest);
			expect(data.displayConfig).toBeNull();
			expect(data.birthdayBonusMultiplier).toBe(1.0);
			expect(data.lastBirthdayBonusYear).toBeNull();
			expect(data.birthDate).toBeNull();
			expect(data.avatarUrl).toBeNull();
			expect(data.userId).toBeNull();
		});

		it('child: _sv=2 のレコードを V3 に変換する（UiMode 移行）', () => {
			const raw = {
				id: 1,
				nickname: 'テスト',
				age: 5,
				uiMode: 'kinder',
				birthDate: null,
				[SCHEMA_VERSION_FIELD]: 2,
				displayConfig: '{"custom": true}',
				birthdayBonusMultiplier: 2.0,
			};

			const { data, didMigrate } = hydrate('child', raw);

			expect(didMigrate).toBe(true);
			expect(data[SCHEMA_VERSION_FIELD]).toBe(3);
			expect(data.uiMode).toBe('preschool'); // kinder → preschool
		});

		it('child: _sv=3 のレコードは変換しない', () => {
			const raw = {
				id: 1,
				nickname: 'テスト',
				age: 5,
				uiMode: 'preschool',
				[SCHEMA_VERSION_FIELD]: 3,
				displayConfig: '{"custom": true}',
				birthdayBonusMultiplier: 2.0,
			};

			const { data, didMigrate } = hydrate('child', raw);

			expect(didMigrate).toBe(false);
			expect(data).toBe(raw);
		});

		it('status: _sv なしレコードを V2 に変換する', () => {
			const raw = {
				id: 1,
				childId: 1,
				categoryId: 1,
				totalXp: 100,
				level: 3,
				// peakXp が 0 → totalXp をコピー
				peakXp: 0,
				updatedAt: '2024-01-01',
			};

			const { data, didMigrate } = hydrate('status', raw);

			expect(didMigrate).toBe(true);
			expect(data[SCHEMA_VERSION_FIELD]).toBe(ENTITY_VERSIONS.status.latest);
			expect(data.peakXp).toBe(100); // totalXp がコピーされた
		});

		it('status: peakXp が既に設定済みなら変更しない', () => {
			const raw = {
				id: 1,
				childId: 1,
				categoryId: 1,
				totalXp: 200,
				level: 5,
				peakXp: 150,
				updatedAt: '2024-01-01',
			};

			const { data, didMigrate } = hydrate('status', raw);

			expect(didMigrate).toBe(true);
			expect(data.peakXp).toBe(150); // 既存値を維持
		});
	});

	describe('withVersion() — 書き込み時のバージョン付与', () => {
		it('child: 新規レコードに最新 _sv を付与する', () => {
			const input = { id: 1, nickname: 'テスト', age: 5 };

			const result = withVersion('child', input);

			expect(result[SCHEMA_VERSION_FIELD]).toBe(ENTITY_VERSIONS.child.latest);
			expect(result.id).toBe(1);
			expect(result.nickname).toBe('テスト');
		});

		it('status: 新規レコードに最新 _sv を付与する', () => {
			const input = { childId: 1, categoryId: 1, totalXp: 0, level: 1, peakXp: 0 };

			const result = withVersion('status', input);

			expect(result[SCHEMA_VERSION_FIELD]).toBe(ENTITY_VERSIONS.status.latest);
		});

		it('既存の _sv を上書きする', () => {
			const input = { id: 1, [SCHEMA_VERSION_FIELD]: 1 };

			const result = withVersion('child', input);

			expect(result[SCHEMA_VERSION_FIELD]).toBe(ENTITY_VERSIONS.child.latest);
		});
	});

	describe('getPipeline() — シングルトン', () => {
		it('同じインスタンスを返す', () => {
			const p1 = getPipeline();
			const p2 = getPipeline();
			expect(p1).toBe(p2);
		});

		it('child と status が登録済み', () => {
			const pipeline = getPipeline();
			const entities = pipeline.getRegisteredEntities();
			expect(entities).toContain('child');
			expect(entities).toContain('status');
		});
	});

	describe('冪等性テスト', () => {
		it('同じレコードを2回 hydrate しても結果が同じ', () => {
			const raw = { id: 1, nickname: 'テスト', age: 5 };

			const first = hydrate('child', raw);
			const second = hydrate('child', first.data);

			expect(second.didMigrate).toBe(false);
			expect(second.data[SCHEMA_VERSION_FIELD]).toBe(first.data[SCHEMA_VERSION_FIELD]);
		});
	});
});
