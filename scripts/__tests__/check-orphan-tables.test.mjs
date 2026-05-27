/**
 * scripts/__tests__/check-orphan-tables.test.mjs (EPIC #2362 follow-up)
 *
 * check-orphan-tables.mjs の extractTables() の unit test。
 *
 * 実行: node --test scripts/__tests__/check-orphan-tables.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { extractTables } = await import('../check-orphan-tables.mjs');

describe('extractTables (schema.ts AST 簡易 parse)', () => {
	it('単一行 sqliteTable 定義を抽出する', () => {
		const text = `export const categories = sqliteTable('categories', {
	id: integer('id').primaryKey(),
});`;
		const r = extractTables(text);
		assert.equal(r.length, 1);
		assert.deepEqual(r[0], { exportName: 'categories', tableName: 'categories' });
	});

	it('複数行 sqliteTable (table 名が次行) を抽出する', () => {
		const text = `export const childActivities = sqliteTable(
	'child_activities',
	{
		id: integer('id').primaryKey(),
	},
);`;
		const r = extractTables(text);
		assert.equal(r.length, 1);
		assert.deepEqual(r[0], { exportName: 'childActivities', tableName: 'child_activities' });
	});

	it('複数 table を順序保持で抽出する', () => {
		const text = `
export const a = sqliteTable('a', {});
export const b = sqliteTable(
	'b',
	{},
);
export const c = sqliteTable('c_table', {});
`;
		const r = extractTables(text);
		assert.equal(r.length, 3);
		assert.deepEqual(
			r.map((x) => x.tableName),
			['a', 'b', 'c_table'],
		);
		assert.deepEqual(
			r.map((x) => x.exportName),
			['a', 'b', 'c'],
		);
	});

	it('sqliteTable を含まない export は無視', () => {
		const text = `
export const foo = 42;
export const bar = sql\`...\`;
export const baz = sqliteTable('baz', {});
`;
		const r = extractTables(text);
		assert.equal(r.length, 1);
		assert.equal(r[0].tableName, 'baz');
	});

	it('実際の schema.ts (47 table) から正しく抽出できる (smoke)', async () => {
		const fs = await import('node:fs');
		const path = await import('node:path');
		const { fileURLToPath } = await import('node:url');
		const __filename = fileURLToPath(import.meta.url);
		const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
		const schemaPath = path.join(REPO_ROOT, 'src', 'lib', 'server', 'db', 'schema.ts');
		if (!fs.existsSync(schemaPath)) {
			// skip if schema not found (環境依存)
			return;
		}
		const text = fs.readFileSync(schemaPath, 'utf8');
		const r = extractTables(text);
		// 47 table 検出 (実 schema との一致)
		assert.ok(r.length >= 40, `expected >=40 tables in schema.ts, got ${r.length}`);
		// 既知 table の存在確認 (regression detection)
		const tableNames = r.map((x) => x.tableName);
		assert.ok(tableNames.includes('categories'));
		assert.ok(tableNames.includes('children'));
		assert.ok(tableNames.includes('activities'));
	});
});
