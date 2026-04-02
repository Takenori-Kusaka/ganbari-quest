// tests/unit/migration/status-transformers.test.ts
// Status エンティティの Transformer テスト

import { describe, expect, it } from 'vitest';
import { statusV1toV2 } from '../../../src/lib/server/db/migration/transformers/status';
import { SCHEMA_VERSION_FIELD } from '../../../src/lib/server/db/migration/types';

describe('Status Transformer: V1→V2', () => {
	it('_sv を 2 に設定する', () => {
		const result = statusV1toV2.transform({ childId: 1, categoryId: 1, totalXp: 100 });
		expect(result[SCHEMA_VERSION_FIELD]).toBe(2);
	});

	it('peakXp が 0 かつ totalXp > 0 なら totalXp をコピー', () => {
		const result = statusV1toV2.transform({
			childId: 1,
			categoryId: 1,
			totalXp: 500,
			peakXp: 0,
			level: 5,
		});
		expect(result.peakXp).toBe(500);
	});

	it('peakXp が既に設定済みなら変更しない', () => {
		const result = statusV1toV2.transform({
			childId: 1,
			categoryId: 1,
			totalXp: 300,
			peakXp: 800,
			level: 3,
		});
		expect(result.peakXp).toBe(800);
	});

	it('totalXp も peakXp も 0 ならそのまま', () => {
		const result = statusV1toV2.transform({
			childId: 1,
			categoryId: 1,
			totalXp: 0,
			peakXp: 0,
			level: 1,
		});
		expect(result.peakXp).toBe(0);
		expect(result.totalXp).toBe(0);
	});

	it('欠落フィールドにデフォルトを設定', () => {
		const result = statusV1toV2.transform({
			childId: 1,
			categoryId: 1,
		});
		expect(result.totalXp).toBe(0);
		expect(result.level).toBe(1);
		expect(result.peakXp).toBe(0);
	});

	it('元レコードを変更しない', () => {
		const original = { childId: 1, categoryId: 1, totalXp: 100, peakXp: 0, level: 2 };
		statusV1toV2.transform(original);
		expect(original.peakXp).toBe(0);
	});
});
