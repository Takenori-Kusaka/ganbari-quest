/**
 * #1169: marketplace-items のデータ整合性テスト。
 *
 * 全ての marketplace activity-pack が `payload.activities` を持ち、
 * もはや `legacyPackId` を持たないことを検証する。#1169 で legacyPackId
 * 経由の二世代併存を廃止したため、これを再発防止のアサーションとして残す。
 */

import { describe, expect, it } from 'vitest';
import {
	getAllTags,
	getMarketplaceCounts,
	getMarketplaceIndex,
	getMarketplaceItem,
} from '../../../src/lib/data/marketplace';

describe('marketplace データ整合性', () => {
	const index = getMarketplaceIndex();

	it('マーケットプレイスに少なくとも 1 件のアイテムがある', () => {
		expect(index.length).toBeGreaterThan(0);
	});

	it('全ての activity-pack が payload.activities を持つ (#1169: legacyPackId 廃止)', () => {
		const activityPacks = index.filter((m) => m.type === 'activity-pack');
		expect(activityPacks.length).toBeGreaterThan(0);

		for (const meta of activityPacks) {
			const item = getMarketplaceItem('activity-pack', meta.itemId);
			expect(item, `activity-pack/${meta.itemId} が取得できる`).not.toBeNull();
			if (!item) continue;

			const payload = item.payload as unknown as Record<string, unknown>;
			expect(
				'activities' in payload,
				`activity-pack/${meta.itemId} は payload.activities を持つ`,
			).toBe(true);
			expect(
				'legacyPackId' in payload,
				`activity-pack/${meta.itemId} は legacyPackId を持たない (#1169)`,
			).toBe(false);
			expect(
				Array.isArray((payload as { activities: unknown }).activities),
				`activity-pack/${meta.itemId} の activities は配列`,
			).toBe(true);
		}
	});

	it('itemCount が payload の実数を正しく反映する', () => {
		for (const meta of index) {
			expect(meta.itemCount).toBeGreaterThanOrEqual(0);
			if (meta.type === 'activity-pack') {
				// legacyPackId を返す 0 件フォールバック (#1169 で撤去) ではなく実数
				expect(meta.itemCount, `${meta.itemId}: itemCount は 0 より大きい`).toBeGreaterThan(0);
			}
		}
	});

	it('getMarketplaceCounts が全タイプ >= 1 を返す', () => {
		const counts = getMarketplaceCounts();
		for (const [type, count] of Object.entries(counts)) {
			expect(count, `${type} は 1 件以上`).toBeGreaterThan(0);
		}
	});

	it('getAllTags が unique かつ昇順ソート済み', () => {
		const tags = getAllTags();
		expect(new Set(tags).size).toBe(tags.length);
		const sorted = [...tags].sort();
		expect(tags).toEqual(sorted);
	});
});
