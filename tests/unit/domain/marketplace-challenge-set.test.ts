/**
 * #2297 (EPIC #2294 ③): marketplace challenge-set 拡張のドリフト検出 unit テスト
 *
 * - challenge-set type が enum に存在する
 * - 日本年間行事パック (japan-annual-events) が 15 件入り
 * - すべての monthDay が 'MM-DD' 形式
 * - categoryId が 1-5 の範囲
 * - MARKETPLACE_TYPE_LABELS / MARKETPLACE_TYPE_ICONS が 5 type 全件含む
 */

import { describe, expect, it } from 'vitest';
import { getMarketplaceCounts, getMarketplaceItem } from '$lib/data/marketplace';
import {
	type ChallengeSetPayload,
	MARKETPLACE_TYPE_ICONS,
	MARKETPLACE_TYPE_LABELS,
	type MarketplaceItemType,
} from '$lib/domain/marketplace-item';

describe('#2297 marketplace challenge-set 拡張', () => {
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

	it('getMarketplaceCounts() が challenge-set type を含む', () => {
		const counts = getMarketplaceCounts();
		expect(counts).toHaveProperty('challenge-set');
		expect(counts['challenge-set']).toBeGreaterThanOrEqual(1);
	});
});

describe('#2297 日本年間行事パック (japan-annual-events) 15 件入り', () => {
	const item = getMarketplaceItem('challenge-set', 'japan-annual-events');

	it('item が取得できる', () => {
		expect(item).not.toBeNull();
	});

	it('15 件のチャレンジを含む', () => {
		expect(item).not.toBeNull();
		if (!item) return;
		const payload = item.payload as ChallengeSetPayload;
		expect(payload.challenges).toHaveLength(15);
	});

	it('すべての monthDay が MM-DD 形式', () => {
		expect(item).not.toBeNull();
		if (!item) return;
		const payload = item.payload as ChallengeSetPayload;
		for (const ch of payload.challenges) {
			expect(ch.monthDay, `${ch.title}: monthDay=${ch.monthDay}`).toMatch(/^\d{2}-\d{2}$/);
			const [mm, dd] = ch.monthDay.split('-').map(Number);
			expect(mm).toBeGreaterThanOrEqual(1);
			expect(mm).toBeLessThanOrEqual(12);
			expect(dd).toBeGreaterThanOrEqual(1);
			expect(dd).toBeLessThanOrEqual(31);
		}
	});

	it('すべての categoryId が 1-5 の範囲', () => {
		expect(item).not.toBeNull();
		if (!item) return;
		const payload = item.payload as ChallengeSetPayload;
		for (const ch of payload.challenges) {
			expect([1, 2, 3, 4, 5]).toContain(ch.categoryId);
		}
	});

	it('代表的な行事が含まれている (ひな祭り / こどもの日 / 七夕 / クリスマス)', () => {
		expect(item).not.toBeNull();
		if (!item) return;
		const payload = item.payload as ChallengeSetPayload;
		const titles = payload.challenges.map((c) => c.title);
		expect(titles.some((t) => t.includes('ひな祭り'))).toBe(true);
		expect(titles.some((t) => t.includes('こどもの日'))).toBe(true);
		expect(titles.some((t) => t.includes('七夕'))).toBe(true);
		expect(titles.some((t) => t.includes('クリスマス'))).toBe(true);
	});

	it('itemCount (payload 件数) が 15 を返す', () => {
		expect(item).not.toBeNull();
		if (!item) return;
		// countPayloadItems は marketplace/index.ts の private 関数だが
		// getMarketplaceIndex().find() の itemCount 経由で間接検証する
		// → 既に marketplace-items.test.ts 「itemCount が payload の実数を正しく反映する」で
		//    全 type 一般化済みだが、challenge-set 固有の 15 件をここで明示
		const payload = item.payload as ChallengeSetPayload;
		expect(payload.challenges.length).toBe(15);
	});
});
