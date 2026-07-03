// tests/unit/services/backup-version-migration-roundtrip.test.ts
// 旧 version 印の backup が lazy migration seam 経由で実 DB に取り込めることの golden round-trip。
//
// validateExportData が MIGRATABLE_VERSIONS から導出した allowlist で旧版を受理し、
// importFamilyData 入口の migrateExportData が現 shape に正規化 → import が成立することを end-to-end で保証する。
// 「追加のみ optional」前提を実証するため、後発 version で追加された top-level optional (data.settings) を
// 剥がした 1.0.0 相当の payload でも child/activity が復元されることを assert する。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { closeDb, createTestDb, resetDb, seedChildActivities } from '../helpers/test-db';

let sqlite: ReturnType<typeof createTestDb>['sqlite'];
let testDb: ReturnType<typeof createTestDb>['db'];

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { clearAllFamilyData } from '../../../src/lib/server/services/data-service';
import { exportFamilyData } from '../../../src/lib/server/services/export-service';
import {
	importFamilyData,
	validateExportData,
} from '../../../src/lib/server/services/import-service';

const T = 't-ver-migrate';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});
afterAll(() => {
	closeDb(sqlite);
});
beforeEach(() => {
	resetDb(sqlite);
});

describe('#3326 系 旧 version backup の lazy migration round-trip', () => {
	it('version=1.0.0 印 + 後発 optional 欠落の backup が seam 経由で child/activity を復元する', async () => {
		// seed: 1 child + 1 activity
		testDb.insert(schema.children).values({ nickname: 'ふるばん', age: 8, theme: 'blue' }).run();
		seedChildActivities(testDb, 1, [{ name: 'うんどう', categoryId: 1, icon: '🏃' }]);

		// 現 version で export → 旧 version 相当に downgrade
		// biome-ignore lint/suspicious/noExplicitAny: テストで旧 shape を擬似的に再現する
		const backup = (await exportFamilyData({ tenantId: T })) as any;
		backup.version = '1.0.0';
		// 1.4.0 で追加された top-level optional を剥がし、1.0.0 相当の「追加のみ前」shape を再現する
		backup.data.settings = undefined;

		// validateExportData は MIGRATABLE_VERSIONS 由来の allowlist で 1.0.0 を受理する
		const v = validateExportData(backup);
		expect(v.valid, '旧 version 1.0.0 が受理される').toBe(true);
		if (!v.valid) return;

		// clear → import (importFamilyData 入口で 1.0.0 → 現 version に migrate される)
		await clearAllFamilyData(T);
		const result = await importFamilyData(v.data, T);

		expect(result.errors).toEqual([]);
		const children = testDb.select().from(schema.children).all();
		expect(children.length, 'child が復元される').toBe(1);
		expect(children[0]?.nickname).toBe('ふるばん');
		const acts = testDb.select().from(schema.childActivities).all();
		expect(acts.length, 'activity が復元される').toBe(1);
	});

	it('未知の未来版は validateExportData で拒否される (hard-fail)', () => {
		// biome-ignore lint/suspicious/noExplicitAny: 不正 version の検証
		const bad: any = {
			format: 'ganbari-quest-backup',
			version: '99.0.0',
			family: { children: [{ nickname: 'x', age: 8, theme: 'blue' }] },
			data: {},
		};
		const v = validateExportData(bad);
		expect(v.valid).toBe(false);
	});
});
