/**
 * marketplace challenge-set 型のドリフト検出 unit テスト
 *
 * 元は #2297 (EPIC #2294 ③) で「日本年間行事パック (japan-annual-events) が marketplace に
 * 陳列される」ことを検証していたが、#2896 (2026-06-11 PO 判断) で marketplace を
 * 活動 / ごほうび / チェックリストの 3 type に絞る方針に伴い、唯一の challenge-set preset を廃止した。
 *
 * 本テストは以下を検証する:
 *  - challenge-set type / labels / icons は互換のため残置されている (型 / 直リンク / admin の ?import=)
 *  - challenge-set は marketplace の production data に陳列されない (3 type 方針)
 *  - 廃止 preset を移管した test fixture が schema / 内容契約を満たし続ける (将来 divergence 検知)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMarketplaceCounts, getMarketplaceItem } from '$lib/data/marketplace';
import {
	type ChallengeSetPayload,
	MARKETPLACE_TYPE_ICONS,
	MARKETPLACE_TYPE_LABELS,
	type MarketplaceItemType,
} from '$lib/domain/marketplace-item';

describe('marketplace challenge-set 型 (互換のため残置)', () => {
	it('MarketplaceItemType に challenge-set を含む 5 type が存在する', () => {
		// 型レベルで強制するため Record<MarketplaceItemType, true> で完全性確認
		const exhaustive: Record<MarketplaceItemType, true> = {
			'activity-pack': true,
			'reward-set': true,
			checklist: true,
			'rule-preset': true,
			'challenge-set': true,
		};
		expect(Object.keys(exhaustive).sort()).toEqual(
			['activity-pack', 'challenge-set', 'checklist', 'reward-set', 'rule-preset'].sort(),
		);
	});

	it('MARKETPLACE_TYPE_LABELS に challenge-set が定義されている', () => {
		expect(MARKETPLACE_TYPE_LABELS['challenge-set']).toBe('チャレンジ集');
	});

	it('MARKETPLACE_TYPE_ICONS に challenge-set が定義されている', () => {
		expect(MARKETPLACE_TYPE_ICONS['challenge-set']).toBe('🎯');
	});

	it('#2896: challenge-set は production marketplace に陳列されない (0 件)', () => {
		// 唯一の preset (japan-annual-events) を廃止したため production data 上は 0 件。
		// type 自体は互換のため counts のキーとして残る。
		const counts = getMarketplaceCounts();
		expect(counts).toHaveProperty('challenge-set');
		expect(counts['challenge-set']).toBe(0);
	});

	it('#2896: japan-annual-events は production marketplace から取得できない', () => {
		expect(getMarketplaceItem('challenge-set', 'japan-annual-events')).toBeNull();
	});
});

describe('#2896 廃止 challenge-set fixture (japan-annual-events) の schema / 内容契約', () => {
	// 廃止 preset は test fixture に移管し、challenge-set 型 / schema の互換 net を維持する。
	const fixturePath = resolve(
		process.cwd(),
		'tests/fixtures/marketplace/challenge-sets/japan-annual-events.json',
	);
	const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
		type: string;
		itemId: string;
		payload: ChallengeSetPayload;
	};

	it('fixture の type / itemId が challenge-set / japan-annual-events', () => {
		expect(fixture.type).toBe('challenge-set');
		expect(fixture.itemId).toBe('japan-annual-events');
	});

	it('15 件のチャレンジを含む', () => {
		expect(fixture.payload.challenges).toHaveLength(15);
	});

	it('すべての monthDay が MM-DD 形式', () => {
		for (const ch of fixture.payload.challenges) {
			expect(ch.monthDay, `${ch.title}: monthDay=${ch.monthDay}`).toMatch(/^\d{2}-\d{2}$/);
			const [mm, dd] = ch.monthDay.split('-').map(Number);
			expect(mm).toBeGreaterThanOrEqual(1);
			expect(mm).toBeLessThanOrEqual(12);
			expect(dd).toBeGreaterThanOrEqual(1);
			expect(dd).toBeLessThanOrEqual(31);
		}
	});

	it('すべての categoryId が 1-5 の範囲', () => {
		for (const ch of fixture.payload.challenges) {
			expect([1, 2, 3, 4, 5]).toContain(ch.categoryId);
		}
	});

	it('代表的な行事が含まれている (ひな祭り / こどもの日 / 七夕 / クリスマス)', () => {
		const titles = fixture.payload.challenges.map((c) => c.title);
		expect(titles.some((t) => t.includes('ひな祭り'))).toBe(true);
		expect(titles.some((t) => t.includes('こどもの日'))).toBe(true);
		expect(titles.some((t) => t.includes('七夕'))).toBe(true);
		expect(titles.some((t) => t.includes('クリスマス'))).toBe(true);
	});
});
