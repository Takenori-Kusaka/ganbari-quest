// tests/unit/services/stamp-card-service.test.ts
// スタンプカードサービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { assertSuccess } from '../helpers/assert-result';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

// todayDateJST をモックして日付を制御（toJSTDateString は実装をそのまま使用）
let mockToday = '2026-03-30'; // 月曜日
vi.mock('$lib/domain/date-utils', async () => {
	const actual = await vi.importActual<typeof import('$lib/domain/date-utils')>(
		'$lib/domain/date-utils',
	);
	return {
		...actual,
		todayDateJST: () => mockToday,
	};
});

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

// insertPointEntry をモックしてDBに直接挿入
vi.mock('$lib/server/db/point-repo', () => ({
	insertPointEntry: async (input: {
		childId: number;
		amount: number;
		type: string;
		description: string;
	}) => {
		testDb
			.insert(schema.pointLedger)
			.values({
				childId: input.childId,
				amount: input.amount,
				type: input.type,
				description: input.description,
			})
			.run();
	},
}));

import {
	autoRedeemPreviousWeek,
	getEnabledStamps,
	getOrCreateCurrentCard,
	getStampCardStatus,
	redeemStampCard,
	stampToday,
} from '../../../src/lib/server/services/stamp-card-service';

beforeAll(() => {
	({ sqlite, db: testDb } = createTestDb());
});

afterAll(() => {
	closeDb(sqlite);
});

function seedChild() {
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 6, theme: 'blue' }).run();
}

function seedStampMasters() {
	// N rarity
	testDb
		.insert(schema.stampMasters)
		.values([
			{ name: 'にこにこ', emoji: '😊', rarity: 'N', isDefault: 1, isEnabled: 1 },
			{ name: 'グッジョブ', emoji: '👍', rarity: 'N', isDefault: 1, isEnabled: 1 },
			{ name: 'スター', emoji: '⭐', rarity: 'N', isDefault: 1, isEnabled: 1 },
		])
		.run();
	// R rarity
	testDb
		.insert(schema.stampMasters)
		.values([
			{ name: 'ロケット', emoji: '🚀', rarity: 'R', isDefault: 1, isEnabled: 1 },
			{ name: 'おうかん', emoji: '👑', rarity: 'R', isDefault: 1, isEnabled: 1 },
		])
		.run();
	// SR rarity
	testDb
		.insert(schema.stampMasters)
		.values([{ name: 'ドラゴン', emoji: '🐉', rarity: 'SR', isDefault: 1, isEnabled: 1 }])
		.run();
	// UR rarity
	testDb
		.insert(schema.stampMasters)
		.values([{ name: 'でんせつのけん', emoji: '⚔️', rarity: 'UR', isDefault: 1, isEnabled: 1 }])
		.run();
}

function seedAll() {
	resetDb(sqlite);
	seedChild();
	seedStampMasters();
}

function insertStampEntry(cardId: number, stampMasterId: number, slot: number, loginDate: string) {
	testDb.insert(schema.stampEntries).values({ cardId, stampMasterId, slot, loginDate }).run();
}

const TENANT = 'test-tenant';

describe('stamp-card-service', () => {
	// ============================================================
	// getEnabledStamps
	// ============================================================
	describe('getEnabledStamps', () => {
		beforeEach(() => {
			seedAll();
		});

		it('有効なスタンプマスタ一覧を返す', async () => {
			const stamps = await getEnabledStamps(TENANT);
			expect(stamps.length).toBe(7);
			// 全てのレアリティが含まれる
			const rarities = new Set(stamps.map((s) => s.rarity));
			expect(rarities.has('N')).toBe(true);
			expect(rarities.has('R')).toBe(true);
			expect(rarities.has('SR')).toBe(true);
			expect(rarities.has('UR')).toBe(true);
		});

		it('無効化されたスタンプは除外される', async () => {
			// 1番目を無効化
			testDb
				.update(schema.stampMasters)
				.set({ isEnabled: 0 })
				.where(
					// biome-ignore lint/suspicious/noExplicitAny: test code
					(require('drizzle-orm') as any).eq(schema.stampMasters.id, 1),
				)
				.run();
			const stamps = await getEnabledStamps(TENANT);
			expect(stamps.length).toBe(6);
			expect(stamps.find((s) => s.name === 'にこにこ')).toBeUndefined();
		});

		it('各スタンプにid, name, emoji, rarityが含まれる', async () => {
			const stamps = await getEnabledStamps(TENANT);
			const first = stamps[0] ?? { id: 0, name: '', emoji: '', rarity: '' };
			expect(typeof first.id).toBe('number');
			expect(typeof first.name).toBe('string');
			expect(typeof first.emoji).toBe('string');
			expect(['N', 'R', 'SR', 'UR']).toContain(first.rarity);
		});
	});

	// ============================================================
	// getOrCreateCurrentCard
	// ============================================================
	describe('getOrCreateCurrentCard', () => {
		beforeEach(() => {
			seedAll();
			mockToday = '2026-03-30'; // 月曜日
		});

		it('新しいカードを作成して返す（今週初回）', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			expect(card.childId).toBe(1);
			expect(card.weekStart).toBe('2026-03-30'); // 月曜
			expect(card.weekEnd).toBe('2026-04-05'); // 日曜
			expect(card.status).toBe('collecting');
			expect(card.entries.length).toBe(0);
			expect(card.canStampToday).toBe(true);
			expect(card.totalSlots).toBe(5);
			expect(card.filledSlots).toBe(0);
			expect(card.redeemedPoints).toBeNull();
		});

		it('既存のカードがあればそれを返す（2回呼び出し）', async () => {
			const card1 = await getOrCreateCurrentCard(1, TENANT);
			const card2 = await getOrCreateCurrentCard(1, TENANT);
			expect(card1.id).toBe(card2.id);
			expect(card1.weekStart).toBe(card2.weekStart);
		});

		it('異なる子供には別のカードを作成する', async () => {
			// 2人目の子供を追加
			testDb
				.insert(schema.children)
				.values({ nickname: 'テスト2号', age: 8, theme: 'green' })
				.run();
			const card1 = await getOrCreateCurrentCard(1, TENANT);
			const card2 = await getOrCreateCurrentCard(2, TENANT);
			expect(card1.id).not.toBe(card2.id);
			expect(card1.childId).toBe(1);
			expect(card2.childId).toBe(2);
		});

		it('週の途中の日付でも正しい週範囲を計算する', async () => {
			mockToday = '2026-04-02'; // 木曜日
			const card = await getOrCreateCurrentCard(1, TENANT);
			expect(card.weekStart).toBe('2026-03-30'); // 同じ週の月曜
			expect(card.weekEnd).toBe('2026-04-05'); // 同じ週の日曜
		});

		it('日曜日でも正しい週範囲を計算する', async () => {
			mockToday = '2026-04-05'; // 日曜日
			const card = await getOrCreateCurrentCard(1, TENANT);
			expect(card.weekStart).toBe('2026-03-30');
			expect(card.weekEnd).toBe('2026-04-05');
		});

		it('canStampTodayは今日押印済みならfalse', async () => {
			// カード作成
			const card = await getOrCreateCurrentCard(1, TENANT);
			// スタンプ押印
			insertStampEntry(card.id, 1, 1, '2026-03-30');

			const updated = await getOrCreateCurrentCard(1, TENANT);
			expect(updated.canStampToday).toBe(false);
			expect(updated.filledSlots).toBe(1);
		});

		it('canStampTodayは5枠埋まっている場合はfalse', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			for (let i = 1; i <= 5; i++) {
				insertStampEntry(card.id, ((i - 1) % 3) + 1, i, `2026-03-${24 + i}`);
			}

			const updated = await getOrCreateCurrentCard(1, TENANT);
			expect(updated.canStampToday).toBe(false);
			expect(updated.filledSlots).toBe(5);
		});

		it('canStampTodayはredeemedカードではfalse', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			// ステータスを直接更新
			testDb
				.update(schema.stampCards)
				.set({ status: 'redeemed' })
				.where(
					// biome-ignore lint/suspicious/noExplicitAny: test code
					(require('drizzle-orm') as any).eq(schema.stampCards.id, card.id),
				)
				.run();

			const updated = await getOrCreateCurrentCard(1, TENANT);
			expect(updated.canStampToday).toBe(false);
		});
	});

	// ============================================================
	// stampToday
	// ============================================================
	describe('stampToday', () => {
		beforeEach(() => {
			seedAll();
			mockToday = '2026-03-30';
		});

		it('正常にスタンプを押印できる', async () => {
			const result = assertSuccess(await stampToday(1, TENANT));
			expect(result.stamp.slot).toBe(1);
			expect(result.stamp.loginDate).toBe('2026-03-30');
			expect(['N', 'R', 'SR', 'UR']).toContain(result.stamp.rarity);
			expect(typeof result.stamp.name).toBe('string');
			expect(typeof result.stamp.emoji).toBe('string');
			expect(result.cardData.filledSlots).toBe(1);
			// 即時ポイントはレア度に応じた値（N:5, R:10, SR:20, UR:40）
			expect(result.instantPoints).toBeGreaterThanOrEqual(5);
		});

		it('スタンプにはomikujiRankが含まれる', async () => {
			const result = assertSuccess(await stampToday(1, TENANT));
			expect(result.stamp.omikujiRank).toBeTruthy();
			expect(['daidaikichi', 'daikichi', 'chukichi', 'shokichi', 'kichi', 'suekichi']).toContain(
				result.stamp.omikujiRank,
			);
		});

		it('連続で2日押印できる', async () => {
			mockToday = '2026-03-30';
			assertSuccess(await stampToday(1, TENANT));

			mockToday = '2026-03-31';
			const result2 = assertSuccess(await stampToday(1, TENANT));
			expect(result2.stamp.slot).toBe(2);
			expect(result2.cardData.filledSlots).toBe(2);
		});

		it('同じ日に2回押印するとALREADY_STAMPEDエラー', async () => {
			await stampToday(1, TENANT);
			const result = await stampToday(1, TENANT);
			expect(result).toEqual({ error: 'ALREADY_STAMPED' });
		});

		it('5枠埋まった後はCARD_FULLエラー', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			for (let i = 1; i <= 5; i++) {
				insertStampEntry(card.id, ((i - 1) % 3) + 1, i, `2026-03-${24 + i}`);
			}

			// 今日（2026-03-30）はエントリに含まれないがカード満杯
			const result = await stampToday(1, TENANT);
			expect(result).toEqual({ error: 'CARD_FULL' });
		});

		it('redeemed済みのカードにはNOT_COLLECTINGエラー', async () => {
			// カード作成後にステータスを変更
			const card = await getOrCreateCurrentCard(1, TENANT);
			testDb
				.update(schema.stampCards)
				.set({ status: 'redeemed' })
				.where(
					// biome-ignore lint/suspicious/noExplicitAny: test code
					(require('drizzle-orm') as any).eq(schema.stampCards.id, card.id),
				)
				.run();

			const result = await stampToday(1, TENANT);
			expect(result).toEqual({ error: 'NOT_COLLECTING' });
		});

		it('スタンプにはスタンプマスタの情報が含まれる', async () => {
			const result = assertSuccess(await stampToday(1, TENANT));
			expect(typeof result.stamp.stampMasterId).toBe('number');
			expect(result.stamp.stampMasterId).toBeGreaterThanOrEqual(1);
			expect(result.stamp.stampMasterId).toBeLessThanOrEqual(7);
			expect(result.stamp.name.length).toBeGreaterThan(0);
			expect(result.stamp.emoji.length).toBeGreaterThan(0);
		});
	});

	// ============================================================
	// レアリティ抽選の境界値テスト（実際の stampToday() 呼び出しで検証）
	// ============================================================
	describe('レアリティ抽選の境界値', () => {
		it('stampToday で取得されるスタンプのレアリティは有効な値', async () => {
			seedAll();
			mockToday = '2026-03-30';
			const result = assertSuccess(await stampToday(1, TENANT));
			expect(['N', 'R', 'SR', 'UR']).toContain(result.stamp.rarity);
		});

		it('Math.random が N/R 境界(60/100) のとき N レアリティが選ばれる', async () => {
			seedAll();
			mockToday = '2026-03-30';
			// N の確率: 60/100 → roll < 60 で N
			// roll = 0.599 * 100 = 59.9 → N 範囲内
			const spy = vi.spyOn(Math, 'random').mockReturnValue(0.599);
			try {
				const result = assertSuccess(await stampToday(1, TENANT));
				expect(result.stamp.rarity).toBe('N');
			} finally {
				spy.mockRestore();
			}
		});

		it('Math.random が R 範囲のとき R レアリティが選ばれる', async () => {
			seedAll();
			mockToday = '2026-03-30';
			// roll = 0.61 * 100 = 61 → N(60) を超え R(25) 範囲内
			const spy = vi.spyOn(Math, 'random').mockReturnValue(0.61);
			try {
				const result = assertSuccess(await stampToday(1, TENANT));
				expect(result.stamp.rarity).toBe('R');
			} finally {
				spy.mockRestore();
			}
		});

		it('Math.random が SR 範囲のとき SR レアリティが選ばれる', async () => {
			seedAll();
			mockToday = '2026-03-30';
			// roll = 0.86 * 100 = 86 → N(60)+R(25)=85 を超え SR(12) 範囲内
			const spy = vi.spyOn(Math, 'random').mockReturnValue(0.86);
			try {
				const result = assertSuccess(await stampToday(1, TENANT));
				expect(result.stamp.rarity).toBe('SR');
			} finally {
				spy.mockRestore();
			}
		});

		it('Math.random が UR 範囲のとき UR レアリティが選ばれる', async () => {
			seedAll();
			mockToday = '2026-03-30';
			// roll = 0.98 * 100 = 98 → N(60)+R(25)+SR(12)=97 を超え UR(3) 範囲内
			const spy = vi.spyOn(Math, 'random').mockReturnValue(0.98);
			try {
				const result = assertSuccess(await stampToday(1, TENANT));
				expect(result.stamp.rarity).toBe('UR');
			} finally {
				spy.mockRestore();
			}
		});

		it('即時ポイント: N レアリティで 5pt', async () => {
			seedAll();
			mockToday = '2026-03-30';
			const spy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
			try {
				const result = assertSuccess(await stampToday(1, TENANT));
				expect(result.stamp.rarity).toBe('N');
				expect(result.instantPoints).toBe(5);
			} finally {
				spy.mockRestore();
			}
		});

		it('即時ポイント: R レアリティで 10pt', async () => {
			seedAll();
			mockToday = '2026-03-30';
			const spy = vi.spyOn(Math, 'random').mockReturnValue(0.61);
			try {
				const result = assertSuccess(await stampToday(1, TENANT));
				expect(result.stamp.rarity).toBe('R');
				expect(result.instantPoints).toBe(10);
			} finally {
				spy.mockRestore();
			}
		});

		it('即時ポイント: SR レアリティで 20pt', async () => {
			seedAll();
			mockToday = '2026-03-30';
			const spy = vi.spyOn(Math, 'random').mockReturnValue(0.86);
			try {
				const result = assertSuccess(await stampToday(1, TENANT));
				expect(result.stamp.rarity).toBe('SR');
				expect(result.instantPoints).toBe(20);
			} finally {
				spy.mockRestore();
			}
		});

		it('即時ポイント: UR レアリティで 40pt', async () => {
			seedAll();
			mockToday = '2026-03-30';
			const spy = vi.spyOn(Math, 'random').mockReturnValue(0.98);
			try {
				const result = assertSuccess(await stampToday(1, TENANT));
				expect(result.stamp.rarity).toBe('UR');
				expect(result.instantPoints).toBe(40);
			} finally {
				spy.mockRestore();
			}
		});
	});

	// ============================================================
	// 曜日非依存テスト（同一週内の非連続日）
	// ============================================================
	describe('曜日非依存: 同一週内の非連続日にスタンプ押印', () => {
		beforeEach(() => {
			seedAll();
		});

		it('月・水・金の非連続3日でスタンプが3枠埋まる', async () => {
			// 月曜
			mockToday = '2026-03-30';
			const mon = assertSuccess(await stampToday(1, TENANT));
			expect(mon.stamp.slot).toBe(1);
			expect(mon.cardData.filledSlots).toBe(1);

			// 水曜（火曜をスキップ）
			mockToday = '2026-04-01';
			const wed = assertSuccess(await stampToday(1, TENANT));
			expect(wed.stamp.slot).toBe(2);
			expect(wed.cardData.filledSlots).toBe(2);

			// 金曜（木曜をスキップ）
			mockToday = '2026-04-03';
			const fri = assertSuccess(await stampToday(1, TENANT));
			expect(fri.stamp.slot).toBe(3);
			expect(fri.cardData.filledSlots).toBe(3);

			// 全て同一カードに属している
			expect(mon.cardData.id).toBe(wed.cardData.id);
			expect(wed.cardData.id).toBe(fri.cardData.id);
		});

		it('火・木・土の非連続3日でも同一カード', async () => {
			// 火曜
			mockToday = '2026-03-31';
			const tue = assertSuccess(await stampToday(1, TENANT));
			expect(tue.stamp.slot).toBe(1);

			// 木曜
			mockToday = '2026-04-02';
			const thu = assertSuccess(await stampToday(1, TENANT));
			expect(thu.stamp.slot).toBe(2);

			// 土曜
			mockToday = '2026-04-04';
			const sat = assertSuccess(await stampToday(1, TENANT));
			expect(sat.stamp.slot).toBe(3);

			// 同一カード
			expect(tue.cardData.id).toBe(thu.cardData.id);
			expect(thu.cardData.id).toBe(sat.cardData.id);
		});
	});

	// ============================================================
	// redeemStampCard（redeem時はスタンプ個数×固定ポイント、レア度無関係）
	// ============================================================
	describe('redeemStampCard', () => {
		beforeEach(() => {
			seedAll();
			mockToday = '2026-03-30';
		});

		it('5枠コンプリートで正しいポイントを計算する（10*5 + 50 = 100）', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			insertStampEntry(card.id, 1, 1, '2026-03-24'); // N
			insertStampEntry(card.id, 2, 2, '2026-03-25'); // N
			insertStampEntry(card.id, 3, 3, '2026-03-26'); // N
			insertStampEntry(card.id, 4, 4, '2026-03-27'); // R
			insertStampEntry(card.id, 6, 5, '2026-03-28'); // SR

			const result = assertSuccess(await redeemStampCard(1, TENANT));
			// 5 stamps * 10pt/stamp = 50 + COMPLETE_BONUS(50) = 100
			expect(result.stampPoints).toBe(50);
			expect(result.completeBonus).toBe(50);
			expect(result.points).toBe(100);
		});

		it('レア度によらずスタンプ1個は10ポイント固定', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			// UR rarity 1枠のみ (stamp_master id=7 はUR)
			insertStampEntry(card.id, 7, 1, '2026-03-24');

			const result = assertSuccess(await redeemStampCard(1, TENANT));
			// 1 stamp * 10pt = 10, not complete => no bonus
			expect(result.stampPoints).toBe(10);
			expect(result.completeBonus).toBe(0);
			expect(result.points).toBe(10);
		});

		it('3枠の場合: 30pt（ボーナスなし）', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			insertStampEntry(card.id, 1, 1, '2026-03-24');
			insertStampEntry(card.id, 4, 2, '2026-03-25');
			insertStampEntry(card.id, 6, 3, '2026-03-26');

			const result = assertSuccess(await redeemStampCard(1, TENANT));
			expect(result.stampPoints).toBe(30);
			expect(result.completeBonus).toBe(0);
			expect(result.points).toBe(30);
		});

		it('交換済みカードはALREADY_REDEEMEDエラー', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			insertStampEntry(card.id, 1, 1, '2026-03-24');

			// 1回目は成功
			assertSuccess(await redeemStampCard(1, TENANT));

			// 2回目はエラー
			const second = await redeemStampCard(1, TENANT);
			expect(second).toEqual({ error: 'ALREADY_REDEEMED' });
		});

		it('スタンプが0枚のカードはEMPTY_CARDエラー', async () => {
			await getOrCreateCurrentCard(1, TENANT);

			const result = await redeemStampCard(1, TENANT);
			expect(result).toEqual({ error: 'EMPTY_CARD' });
		});

		it('交換後にカードのステータスがredeemedに変わる', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			insertStampEntry(card.id, 1, 1, '2026-03-24');

			await redeemStampCard(1, TENANT);

			const updated = await getOrCreateCurrentCard(1, TENANT);
			expect(updated.status).toBe('redeemed');
		});

		it('交換後にredeemedPointsが記録される', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			insertStampEntry(card.id, 1, 1, '2026-03-24'); // 10pt

			assertSuccess(await redeemStampCard(1, TENANT));

			const updated = await getOrCreateCurrentCard(1, TENANT);
			expect(updated.redeemedPoints).toBe(10);
		});

		it('交換後にpoint_ledgerにエントリが追加される', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			insertStampEntry(card.id, 1, 1, '2026-03-24'); // 10pt

			await redeemStampCard(1, TENANT);

			const ledger = testDb
				.select()
				.from(schema.pointLedger)
				.where(
					// biome-ignore lint/suspicious/noExplicitAny: test code
					(require('drizzle-orm') as any).eq(schema.pointLedger.childId, 1),
				)
				.all();
			expect(ledger.length).toBe(1);
			expect(ledger[0]?.type).toBe('stamp_card');
			expect(ledger[0]?.amount).toBe(10);
		});
	});

	// ============================================================
	// ポイント計算のビジネスロジック
	// ============================================================
	describe('ポイント計算のビジネスロジック', () => {
		beforeEach(() => {
			seedAll();
			mockToday = '2026-03-30';
		});

		it('POINTS_PER_STAMP = 10, COMPLETE_BONUS = 50, MAX_SLOTS = 5', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			expect(card.totalSlots).toBe(5); // MAX_SLOTS

			// 5枠すべてで埋める
			insertStampEntry(card.id, 1, 1, '2026-03-24');
			insertStampEntry(card.id, 2, 2, '2026-03-25');
			insertStampEntry(card.id, 3, 3, '2026-03-26');
			insertStampEntry(card.id, 1, 4, '2026-03-27');
			insertStampEntry(card.id, 2, 5, '2026-03-28');

			const result = assertSuccess(await redeemStampCard(1, TENANT));
			// 5 * 10 = 50 + 50 (bonus) = 100
			expect(result.points).toBe(100);
		});

		it('4枠ではコンプリートボーナスなし', async () => {
			const card = await getOrCreateCurrentCard(1, TENANT);
			insertStampEntry(card.id, 1, 1, '2026-03-24');
			insertStampEntry(card.id, 2, 2, '2026-03-25');
			insertStampEntry(card.id, 3, 3, '2026-03-26');
			insertStampEntry(card.id, 1, 4, '2026-03-27');

			const result = assertSuccess(await redeemStampCard(1, TENANT));
			expect(result.completeBonus).toBe(0);
			expect(result.stampPoints).toBe(40); // 4 * 10
			expect(result.points).toBe(40);
		});
	});

	// ============================================================
	// getStampCardStatus
	// ============================================================
	describe('getStampCardStatus', () => {
		beforeEach(() => {
			seedAll();
			mockToday = '2026-03-30';
		});

		it('正常にカードデータを返す', async () => {
			const status = await getStampCardStatus(1, TENANT);
			expect(status).not.toBeNull();
			expect(status?.childId).toBe(1);
			expect(status?.status).toBe('collecting');
		});

		it('存在しないchildIdではnullを返す', async () => {
			const status = await getStampCardStatus(999, TENANT);
			expect(status).toBeNull();
		});
	});

	// ============================================================
	// 週境界テスト
	// ============================================================
	describe('週境界の処理', () => {
		beforeEach(() => {
			seedAll();
		});

		it('異なる週は別のカードが作成される', async () => {
			mockToday = '2026-03-30'; // 第1週の月曜
			const card1 = await getOrCreateCurrentCard(1, TENANT);

			mockToday = '2026-04-06'; // 第2週の月曜
			const card2 = await getOrCreateCurrentCard(1, TENANT);

			expect(card1.id).not.toBe(card2.id);
			expect(card1.weekStart).toBe('2026-03-30');
			expect(card2.weekStart).toBe('2026-04-06');
		});

		it('同じ週の別の日は同じカードを返す', async () => {
			mockToday = '2026-03-30'; // 月曜
			const card1 = await getOrCreateCurrentCard(1, TENANT);

			mockToday = '2026-04-03'; // 金曜（同じ週）
			const card2 = await getOrCreateCurrentCard(1, TENANT);

			expect(card1.id).toBe(card2.id);
		});
	});

	// ============================================================
	// autoRedeemPreviousWeek
	// ============================================================
	describe('autoRedeemPreviousWeek', () => {
		beforeEach(() => {
			seedAll();
		});

		it('前週のカードを自動redeemしてポイントを返す', async () => {
			// 前週（2026-03-23〜2026-03-29）にカードを作成してスタンプ押印
			mockToday = '2026-03-23';
			const prevCard = await getOrCreateCurrentCard(1, TENANT);
			insertStampEntry(prevCard.id, 1, 1, '2026-03-23');
			insertStampEntry(prevCard.id, 2, 2, '2026-03-24');
			insertStampEntry(prevCard.id, 4, 3, '2026-03-25');

			// 今週の月曜にautoRedeem
			mockToday = '2026-03-30';
			const result = await autoRedeemPreviousWeek(1, TENANT);
			expect(result).not.toBeNull();
			expect(result?.stampPoints).toBe(30); // 3 * 10
			expect(result?.completeBonus).toBe(0); // 3/5 未完了
			expect(result?.points).toBe(30);
			expect(result?.filledSlots).toBe(3);
			expect(result?.totalSlots).toBe(5);
		});

		it('前週のカードがない場合はnullを返す', async () => {
			mockToday = '2026-03-30';
			const result = await autoRedeemPreviousWeek(1, TENANT);
			expect(result).toBeNull();
		});

		it('前週のカードがすでにredeem済みの場合はnullを返す', async () => {
			mockToday = '2026-03-23';
			const prevCard = await getOrCreateCurrentCard(1, TENANT);
			insertStampEntry(prevCard.id, 1, 1, '2026-03-23');
			await redeemStampCard(1, TENANT);

			mockToday = '2026-03-30';
			const result = await autoRedeemPreviousWeek(1, TENANT);
			expect(result).toBeNull();
		});

		it('5枠コンプリートでボーナスが付与される', async () => {
			mockToday = '2026-03-23';
			const prevCard = await getOrCreateCurrentCard(1, TENANT);
			for (let i = 1; i <= 5; i++) {
				insertStampEntry(prevCard.id, ((i - 1) % 3) + 1, i, `2026-03-${22 + i}`);
			}

			mockToday = '2026-03-30';
			const result = await autoRedeemPreviousWeek(1, TENANT);
			expect(result).not.toBeNull();
			expect(result?.stampPoints).toBe(50); // 5 * 10
			expect(result?.completeBonus).toBe(50);
			expect(result?.points).toBe(100); // 50 + 50
			expect(result?.filledSlots).toBe(5);
		});

		it('loginMultiplierが反映される', async () => {
			mockToday = '2026-03-23';
			const prevCard = await getOrCreateCurrentCard(1, TENANT);
			insertStampEntry(prevCard.id, 1, 1, '2026-03-23'); // 10pt

			mockToday = '2026-03-30';
			const result = await autoRedeemPreviousWeek(1, TENANT, 2);
			expect(result).not.toBeNull();
			// 10 * 2 (multiplier) = 20
			expect(result?.points).toBe(20);
			expect(result?.multiplier).toBe(2);
		});
	});
});
