// tests/unit/services/activity-log-service.test.ts
// 活動記録サービスのユニットテスト

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calcStreakBonus } from '../../../src/lib/domain/validation/activity';
import * as schema from '../../../src/lib/server/db/schema';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

let sqlite: TestSqlite;
let db: TestDb;

beforeAll(() => {
	({ sqlite, db } = createTestDb());
});

afterAll(() => {
	closeDb(sqlite);
});

beforeEach(() => {
	resetDb(sqlite);

	// Insert test data
	db.insert(schema.children).values({ nickname: 'テスト子', age: 4 }).run();
	db.insert(schema.activities)
		.values({ name: 'たいそう', categoryId: 1, icon: '🤸', basePoints: 5 })
		.run();
	db.insert(schema.activities)
		.values({ name: 'えほん', categoryId: 2, icon: '📖', basePoints: 5 })
		.run();
});

describe('calcStreakBonus', () => {
	it('1日目はボーナスなし', () => {
		expect(calcStreakBonus(1)).toBe(0);
	});

	it('2日連続で+1ボーナス', () => {
		expect(calcStreakBonus(2)).toBe(1);
	});

	it('5日連続で+4ボーナス', () => {
		expect(calcStreakBonus(5)).toBe(4);
	});

	it('11日連続で上限+10ボーナス', () => {
		expect(calcStreakBonus(11)).toBe(10);
	});

	it('100日連続でも上限+10ボーナス', () => {
		expect(calcStreakBonus(100)).toBe(10);
	});

	it('0日はボーナスなし', () => {
		expect(calcStreakBonus(0)).toBe(0);
	});
});

describe('活動記録の挿入', () => {
	it('初回記録でstreakDays=1、ポイント付与', () => {
		const log = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		expect(log.streakDays).toBe(1);
		expect(log.streakBonus).toBe(0);
		expect(log.cancelled).toBe(0);
	});

	it('同日同活動の複数記録が可能（dailyLimit制御はサービス層）', () => {
		db.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.run();

		const log2 = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		expect(log2.activityId).toBe(1);

		const logs = db.select().from(schema.activityLogs).all();
		expect(logs).toHaveLength(2);
	});

	it('別活動なら同日に記録可能', () => {
		db.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.run();

		const log2 = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 2,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		expect(log2.activityId).toBe(2);
	});

	it('別日なら同活動を記録可能', () => {
		db.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.run();

		const log2 = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 2,
				streakBonus: 1,
				recordedDate: '2026-02-21',
			})
			.returning()
			.get();

		expect(log2.streakDays).toBe(2);
		expect(log2.streakBonus).toBe(1);
	});
});

describe('連続日数の記録', () => {
	it('3日連続記録のstreakが正しい', () => {
		const dates = ['2026-02-18', '2026-02-19', '2026-02-20'];
		const expectedStreaks = [1, 2, 3];

		for (let i = 0; i < dates.length; i++) {
			const date = dates[i];
			const streak = expectedStreaks[i];
			if (!date || streak === undefined) throw new Error(`Expected data at index ${i}`);
			db.insert(schema.activityLogs)
				.values({
					childId: 1,
					activityId: 1,
					points: 5,
					streakDays: streak,
					streakBonus: calcStreakBonus(streak),
					recordedDate: date,
				})
				.run();
		}

		const logs = db
			.select()
			.from(schema.activityLogs)
			.orderBy(schema.activityLogs.recordedDate)
			.all();

		expect(logs).toHaveLength(3);
		expect(logs[0]?.streakDays).toBe(1);
		expect(logs[0]?.streakBonus).toBe(0);
		expect(logs[1]?.streakDays).toBe(2);
		expect(logs[1]?.streakBonus).toBe(1);
		expect(logs[2]?.streakDays).toBe(3);
		expect(logs[2]?.streakBonus).toBe(2);
	});
});

describe('キャンセル', () => {
	it('キャンセルフラグを立てられる', () => {
		const _log = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		db.update(schema.activityLogs).set({ cancelled: 1 }).run();

		const updated = db.select().from(schema.activityLogs).get();
		expect(updated?.cancelled).toBe(1);
	});

	it('キャンセル後も再記録が可能', () => {
		db.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
				cancelled: 1,
			})
			.run();

		const log2 = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		expect(log2.cancelled).toBe(0);
	});
});

describe('ポイント台帳', () => {
	it('活動記録と同時にポイントが加算される', () => {
		const log = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				streakDays: 3,
				streakBonus: 2,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		db.insert(schema.pointLedger)
			.values({
				childId: 1,
				amount: 7,
				type: 'activity',
				description: 'たいそう (3日連続+2)',
				referenceId: log.id,
			})
			.run();

		const ledger = db.select().from(schema.pointLedger).all();
		expect(ledger).toHaveLength(1);
		expect(ledger[0]?.amount).toBe(7);
		expect(ledger[0]?.type).toBe('activity');
	});

	it('キャンセルでマイナスポイントが記録される', () => {
		const log = db
			.insert(schema.activityLogs)
			.values({
				childId: 1,
				activityId: 1,
				points: 5,
				recordedDate: '2026-02-20',
			})
			.returning()
			.get();

		db.insert(schema.pointLedger)
			.values({ childId: 1, amount: 5, type: 'activity', referenceId: log.id })
			.run();

		db.insert(schema.pointLedger)
			.values({ childId: 1, amount: -5, type: 'cancel', referenceId: log.id })
			.run();

		const ledger = db.select().from(schema.pointLedger).all();
		const total = ledger.reduce((sum, e) => sum + e.amount, 0);
		expect(total).toBe(0);
	});
});

describe('dailyLimit（DB層テスト）', () => {
	it('dailyLimit=nullの活動はデフォルト値', () => {
		const activity = db.select().from(schema.activities).get();
		expect(activity?.dailyLimit).toBeNull();
	});

	it('dailyLimit=2の活動を作成・取得', () => {
		db.insert(schema.activities)
			.values({ name: 'はみがき', categoryId: 3, icon: '🪥', basePoints: 3, dailyLimit: 2 })
			.run();

		const activities = db.select().from(schema.activities).all();
		const hamigaki = activities.find((a) => a.name === 'はみがき');
		expect(hamigaki?.dailyLimit).toBe(2);
	});

	it('dailyLimit=0（無制限）の活動を作成・取得', () => {
		db.insert(schema.activities)
			.values({ name: 'おそうじ', categoryId: 3, icon: '🧹', basePoints: 3, dailyLimit: 0 })
			.run();

		const activities = db.select().from(schema.activities).all();
		const osouji = activities.find((a) => a.name === 'おそうじ');
		expect(osouji?.dailyLimit).toBe(0);
	});

	it('dailyLimit=2の活動で同日に2回記録が可能', () => {
		db.insert(schema.activities)
			.values({ name: 'はみがき2', categoryId: 3, icon: '🪥', basePoints: 3, dailyLimit: 2 })
			.run();

		const activities = db.select().from(schema.activities).all();
		const act = activities.find((a) => a.name === 'はみがき2');
		if (!act) throw new Error('Test setup: はみがき2 not found');

		db.insert(schema.activityLogs)
			.values({ childId: 1, activityId: act.id, points: 3, recordedDate: '2026-02-20' })
			.run();
		db.insert(schema.activityLogs)
			.values({ childId: 1, activityId: act.id, points: 3, recordedDate: '2026-02-20' })
			.run();

		const logs = db
			.select()
			.from(schema.activityLogs)
			.where(
				and(
					eq(schema.activityLogs.activityId, act.id),
					eq(schema.activityLogs.recordedDate, '2026-02-20'),
				),
			)
			.all();
		expect(logs).toHaveLength(2);
	});
});
