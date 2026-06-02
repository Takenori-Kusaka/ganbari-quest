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

	it('getAllTags が unique かつ人気順 (frequency desc) sort 済 (Round 18 Cluster I)', () => {
		const tags = getAllTags();
		// uniqueness
		expect(new Set(tags).size).toBe(tags.length);

		// popularity (frequency desc) sort assertion
		// LP filter sidebar が default 8 件で人気 tag を優先表示するため必須
		const items = getMarketplaceIndex();
		const frequency = new Map<string, number>();
		for (const item of items) {
			for (const tag of item.tags) {
				frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
			}
		}
		for (let i = 0; i < tags.length - 1; i++) {
			const tagA = tags[i];
			const tagB = tags[i + 1];
			if (tagA === undefined || tagB === undefined) continue;
			const fa = frequency.get(tagA) ?? 0;
			const fb = frequency.get(tagB) ?? 0;
			// 同 frequency 内は localeCompare('ja') asc は要件として強制しない
			// (test brittle 防止、上位 N 件で人気が前に来る性質のみ assert)
			expect(fa).toBeGreaterThanOrEqual(fb);
		}
	});
});
