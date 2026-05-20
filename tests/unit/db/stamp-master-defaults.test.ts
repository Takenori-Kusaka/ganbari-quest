// tests/unit/db/stamp-master-defaults.test.ts
// stamp-master-defaults.ts SSOT (16 stamps) の構造検証

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_STAMP_MASTERS_DATA,
	getDefaultStampMasters,
} from '../../../src/lib/server/db/stamp-master-defaults';

describe('stamp-master-defaults', () => {
	describe('DEFAULT_STAMP_MASTERS_DATA', () => {
		it('16 件を保持する (N×5 + R×5 + SR×4 + UR×2)', () => {
			expect(DEFAULT_STAMP_MASTERS_DATA.length).toBe(16);
		});

		it('全 id がユニーク (1-16)', () => {
			const ids = DEFAULT_STAMP_MASTERS_DATA.map((s) => s.id).sort((a, b) => a - b);
			expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
		});

		it('rarity 別の件数が確定値と一致する', () => {
			const byRarity = DEFAULT_STAMP_MASTERS_DATA.reduce<Record<string, number>>((acc, s) => {
				acc[s.rarity] = (acc[s.rarity] ?? 0) + 1;
				return acc;
			}, {});
			expect(byRarity).toEqual({ N: 5, R: 5, SR: 4, UR: 2 });
		});

		it('全 stamp が emoji と name を保持する', () => {
			for (const s of DEFAULT_STAMP_MASTERS_DATA) {
				expect(s.emoji.length).toBeGreaterThan(0);
				expect(s.name.length).toBeGreaterThan(0);
			}
		});

		it('rarity は N | R | SR | UR のみ', () => {
			const validRarities = ['N', 'R', 'SR', 'UR'];
			for (const s of DEFAULT_STAMP_MASTERS_DATA) {
				expect(validRarities).toContain(s.rarity);
			}
		});
	});

	describe('getDefaultStampMasters', () => {
		it('16 件の StampMaster エンティティを返す', () => {
			const stamps = getDefaultStampMasters();
			expect(stamps.length).toBe(16);
		});

		it('全 stamp の isEnabled / isDefault が 1', () => {
			const stamps = getDefaultStampMasters();
			for (const s of stamps) {
				expect(s.isEnabled).toBe(1);
				expect(s.isDefault).toBe(1);
			}
		});

		it('now パラメータで createdAt / updatedAt が固定される', () => {
			const now = '2026-05-20T00:00:00.000Z';
			const stamps = getDefaultStampMasters(now);
			for (const s of stamps) {
				expect(s.createdAt).toBe(now);
				expect(s.updatedAt).toBe(now);
			}
		});

		it('デフォルト now (引数省略) でも ISO 8601 形式の文字列が入る', () => {
			const stamps = getDefaultStampMasters();
			const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
			expect(isoRegex.test(stamps[0]?.createdAt ?? '')).toBe(true);
		});

		it('返り値は呼び出しごとに新しい配列 (参照同一でない)', () => {
			const a = getDefaultStampMasters();
			const b = getDefaultStampMasters();
			expect(a).not.toBe(b); // 異なる配列参照
			expect(a.length).toBe(b.length);
		});
	});
});
