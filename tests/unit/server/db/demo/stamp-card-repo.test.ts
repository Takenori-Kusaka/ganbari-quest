// tests/unit/server/db/demo/stamp-card-repo.test.ts
// #2097 Phase B-2: demo Stamp Card Repo の Fake (read) + Stub (write) hybrid 検証。
// production seed と同じ 16 種マスタを返し、4 子供 (902/903/904/906) に当週 + 前週カードを供給する。

import { describe, expect, it } from 'vitest';
import * as stampCardRepo from '../../../../../src/lib/server/db/demo/stamp-card-repo';
import {
	DEMO_STAMP_CARDS,
	DEMO_STAMP_ENTRIES,
	DEMO_STAMP_MASTERS,
} from '../../../../../src/lib/server/demo/demo-data';

const CURRENT_WEEK_START = '2026-03-23';
const PREV_WEEK_START = '2026-03-16';

describe('demo/stamp-card-repo (#2097 Phase B-2)', () => {
	describe('findEnabledStampMasters', () => {
		it('production seed と同じ 16 種を返す', async () => {
			const masters = await stampCardRepo.findEnabledStampMasters('demo');
			expect(masters.length).toBe(16);
			expect(masters.length).toBe(DEMO_STAMP_MASTERS.length);
		});

		it('全マスタが isEnabled=1', async () => {
			const masters = await stampCardRepo.findEnabledStampMasters('demo');
			expect(masters.every((m) => m.isEnabled === 1)).toBe(true);
		});

		it('全 4 レアリティ (N / R / SR / UR) を含む', async () => {
			const masters = await stampCardRepo.findEnabledStampMasters('demo');
			const rarities = new Set(masters.map((m) => m.rarity));
			expect(rarities).toEqual(new Set(['N', 'R', 'SR', 'UR']));
		});

		it('レアリティ比率: N=5, R=5, SR=4, UR=2', async () => {
			const masters = await stampCardRepo.findEnabledStampMasters('demo');
			const byRarity = masters.reduce<Record<string, number>>((acc, m) => {
				acc[m.rarity] = (acc[m.rarity] ?? 0) + 1;
				return acc;
			}, {});
			expect(byRarity).toEqual({ N: 5, R: 5, SR: 4, UR: 2 });
		});
	});

	describe('findCardByChildAndWeek', () => {
		// 4 子供 (902 ひな / 903 けんた / 904 さくら / 906 けいすけ) × 当週 / 前週
		// 901 たろう (baby) は ADR-0011 によりスタンプカード非表示 → fixture 対象外

		it.each([902, 903, 904, 906])('childId=%i: 当週 active card が取れる', async (childId) => {
			const card = await stampCardRepo.findCardByChildAndWeek(childId, CURRENT_WEEK_START, 'demo');
			expect(card).toBeDefined();
			expect(card?.childId).toBe(childId);
			expect(card?.weekStart).toBe(CURRENT_WEEK_START);
			expect(card?.status).toBe('collecting');
			expect(card?.redeemedPoints).toBeNull();
		});

		it.each([902, 903, 904, 906])('childId=%i: 前週 redeemed card が取れる', async (childId) => {
			const card = await stampCardRepo.findCardByChildAndWeek(childId, PREV_WEEK_START, 'demo');
			expect(card).toBeDefined();
			expect(card?.childId).toBe(childId);
			expect(card?.weekStart).toBe(PREV_WEEK_START);
			expect(card?.status).toBe('redeemed');
			expect(card?.redeemedPoints).toBe(100); // 5*10 + 50 complete bonus
		});

		it('baby (childId=901) はカード未登録 → undefined', async () => {
			const card = await stampCardRepo.findCardByChildAndWeek(901, CURRENT_WEEK_START, 'demo');
			expect(card).toBeUndefined();
		});

		it('未登録の週 (2 週前) は undefined', async () => {
			const card = await stampCardRepo.findCardByChildAndWeek(902, '2026-03-09', 'demo');
			expect(card).toBeUndefined();
		});
	});

	describe('findEntriesWithMasterByCardId', () => {
		it('902 当週カード (cardId=702): 2 件、master 情報付き', async () => {
			const entries = await stampCardRepo.findEntriesWithMasterByCardId(702, 'demo');
			expect(entries.length).toBe(2);
			expect(entries[0]?.name).toBeTruthy();
			expect(entries[0]?.emoji).toBeTruthy();
			expect(entries[0]?.rarity).toBeTruthy();
			expect(entries[0]?.slot).toBe(1);
			expect(entries[1]?.slot).toBe(2);
		});

		it('902 前週カード (cardId=802): 5/5 完了', async () => {
			const entries = await stampCardRepo.findEntriesWithMasterByCardId(802, 'demo');
			expect(entries.length).toBe(5);
			expect(entries.map((e) => e.slot)).toEqual([1, 2, 3, 4, 5]);
		});

		it.each([
			[703, 3], // 903 当週
			[704, 4], // 904 当週
			[706, 4], // 906 当週
		])('cardId=%i: %i 件のエントリ', async (cardId, expected) => {
			const entries = await stampCardRepo.findEntriesWithMasterByCardId(cardId, 'demo');
			expect(entries.length).toBe(expected);
		});

		it.each([803, 804, 806])('前週 cardId=%i は 5/5 完了 (redeemable な状態)', async (cardId) => {
			const entries = await stampCardRepo.findEntriesWithMasterByCardId(cardId, 'demo');
			expect(entries.length).toBe(5);
		});

		it('未登録 cardId は空配列', async () => {
			const entries = await stampCardRepo.findEntriesWithMasterByCardId(99999, 'demo');
			expect(entries).toEqual([]);
		});

		it('entries の master join: rarity が N / R / SR / UR のいずれか', async () => {
			const entries = await stampCardRepo.findEntriesWithMasterByCardId(806, 'demo');
			for (const e of entries) {
				expect(['N', 'R', 'SR', 'UR']).toContain(e.rarity);
			}
		});
	});

	describe('fixture 整合性 (DEMO_STAMP_CARDS / DEMO_STAMP_ENTRIES)', () => {
		it('全 entry が DEMO_STAMP_CARDS の card に紐づく', () => {
			const cardIds = new Set(DEMO_STAMP_CARDS.map((c) => c.id));
			for (const entry of DEMO_STAMP_ENTRIES) {
				expect(cardIds.has(entry.cardId)).toBe(true);
			}
		});

		it('全 entry の stampMasterId が DEMO_STAMP_MASTERS に存在', () => {
			const masterIds = new Set(DEMO_STAMP_MASTERS.map((m) => m.id));
			for (const entry of DEMO_STAMP_ENTRIES) {
				if (entry.stampMasterId !== null) {
					expect(masterIds.has(entry.stampMasterId)).toBe(true);
				}
			}
		});

		it('全 card の childId が demo 4 子供 (902/903/904/906) のいずれか', () => {
			const validChildIds = new Set([902, 903, 904, 906]);
			for (const card of DEMO_STAMP_CARDS) {
				expect(validChildIds.has(card.childId)).toBe(true);
			}
		});

		it('当週 (2026-03-23) card は 4 子供分すべて collecting', () => {
			const currentWeekCards = DEMO_STAMP_CARDS.filter((c) => c.weekStart === CURRENT_WEEK_START);
			expect(currentWeekCards.length).toBe(4);
			expect(currentWeekCards.every((c) => c.status === 'collecting')).toBe(true);
		});

		it('前週 (2026-03-16) card は 4 子供分すべて redeemed', () => {
			const prevWeekCards = DEMO_STAMP_CARDS.filter((c) => c.weekStart === PREV_WEEK_START);
			expect(prevWeekCards.length).toBe(4);
			expect(prevWeekCards.every((c) => c.status === 'redeemed')).toBe(true);
			expect(prevWeekCards.every((c) => c.redeemedPoints === 100)).toBe(true);
		});

		it('各 card の slot は 1 から連番', () => {
			for (const card of DEMO_STAMP_CARDS) {
				const slots = DEMO_STAMP_ENTRIES.filter((e) => e.cardId === card.id)
					.map((e) => e.slot)
					.sort((a, b) => a - b);
				// 連番 (1, 2, 3, ...) であること
				slots.forEach((slot, idx) => {
					expect(slot).toBe(idx + 1);
				});
			}
		});
	});

	describe('Stub write API は no-op (DB 変更しない)', () => {
		it('insertCard は input をそのまま返す', async () => {
			const card = await stampCardRepo.insertCard(
				{
					childId: 902,
					weekStart: '2026-04-13',
					weekEnd: '2026-04-19',
					status: 'collecting',
				},
				'demo',
			);
			expect(card.id).toBe(0);
			expect(card.childId).toBe(902);
		});

		it('insertEntry は no-op', async () => {
			await expect(
				stampCardRepo.insertEntry(
					{
						cardId: 702,
						stampMasterId: 1,
						omikujiRank: 'kichi',
						slot: 3,
						loginDate: '2026-03-25',
					},
					'demo',
				),
			).resolves.toBeUndefined();
		});

		it('updateCardStatus / updateCardStatusIfCollecting は no-op / 0', async () => {
			await expect(
				stampCardRepo.updateCardStatus(
					902,
					702,
					{
						status: 'redeemed',
						redeemedPoints: 50,
						redeemedAt: '2026-03-29T00:00:00.000Z',
						updatedAt: '2026-03-29T00:00:00.000Z',
					},
					'demo',
				),
			).resolves.toBeUndefined();

			expect(
				await stampCardRepo.updateCardStatusIfCollecting(
					902,
					702,
					{
						status: 'redeemed',
						redeemedPoints: 50,
						redeemedAt: '2026-03-29T00:00:00.000Z',
						updatedAt: '2026-03-29T00:00:00.000Z',
					},
					'demo',
				),
			).toBe(0);
		});

		it('deleteByTenantId は no-op', async () => {
			await expect(stampCardRepo.deleteByTenantId('demo')).resolves.toBeUndefined();
		});
	});
});
