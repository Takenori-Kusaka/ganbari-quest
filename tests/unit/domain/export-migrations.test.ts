// tests/unit/domain/export-migrations.test.ts
// backup の lazy マイグレーション seam (eager copy-transform) の単体検証。
// - 旧 version → 現 version への正規化 (現状 identity)
// - 【bump tripwire】EXPORT_VERSION を bump して STEP を登録し忘れると fail (追加のみ不変条件の機械ガード)
// - 未知の未来版は hard-fail (pg_dump 精神)

import { describe, expect, it } from 'vitest';
import { EXPORT_VERSION } from '../../../src/lib/domain/export-format';
import { MIGRATABLE_VERSIONS, migrateExportData } from '../../../src/lib/domain/export-migrations';

describe('export-migrations — lazy migration seam', () => {
	it('現 version はそのまま、version は EXPORT_VERSION を維持し他フィールドを保全する', () => {
		const d = { format: 'ganbari-quest-backup', version: EXPORT_VERSION, foo: 1, bar: 'x' };
		const m = migrateExportData(d, EXPORT_VERSION);
		expect(m.version).toBe(EXPORT_VERSION);
		expect(m.foo).toBe(1);
		expect(m.bar).toBe('x');
	});

	it('旧 version は EXPORT_VERSION に正規化され、フィールドは保全される (additive identity)', () => {
		const d = { format: 'ganbari-quest-backup', version: '1.0.0', foo: 'keep' };
		const m = migrateExportData(d, '1.0.0');
		expect(m.version).toBe(EXPORT_VERSION);
		expect(m.foo).toBe('keep');
	});

	it('【bump tripwire】MIGRATABLE_VERSIONS は EXPORT_VERSION を含む (bump 時の STEP 登録漏れを検出)', () => {
		// EXPORT_VERSION を bump して STEP を追加し忘れると、MIGRATABLE_VERSIONS に新 version が
		// 含まれず本 assert が fail する → 「additive か breaking か」を毎回宣言させる機械ガード。
		expect(MIGRATABLE_VERSIONS).toContain(EXPORT_VERSION);
	});

	it('【chain 網羅】全 MIGRATABLE_VERSIONS が throw せず EXPORT_VERSION まで到達する', () => {
		for (const v of MIGRATABLE_VERSIONS) {
			expect(() => migrateExportData({ version: v }, v), `version ${v} の移行経路`).not.toThrow();
			expect(migrateExportData({ version: v }, v).version).toBe(EXPORT_VERSION);
		}
	});

	it('未知の未来版は hard-fail する (silent な誤読を防ぐ)', () => {
		expect(() => migrateExportData({ version: '99.0.0' }, '99.0.0')).toThrow();
	});
});
