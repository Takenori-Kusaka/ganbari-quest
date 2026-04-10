// tests/unit/services/activity-log-service.test.ts
// 活動記録サービスのユニットテスト — recordActivity() / cancelActivityLog() を直接呼ぶ

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { assertSuccess } from '../helpers/assert-result';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

// todayDate をモックして日付を制御
let mockToday = '2026-02-20';
vi.mock('$lib/domain/date-utils', () => ({
	todayDateJST: () => mockToday,
	toJSTDateString: (date: Date) => {
		const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
		return jst.toISOString().slice(0, 10);
	},
}));

// DB モック: SQLite リポジトリがテスト用インメモリ DB を使うようにする
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

// ロガーをモック
vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

import { calcStreakBonus } from '../../../src/lib/domain/validation/activity';
// サービス層をインポート（モック設定後に行う）
import {
	cancelActivityLog,
	type RecordActivityResult,
	recordActivity,
} from '../../../src/lib/server/services/activity-log-service';

const TENANT = 'test-tenant';

beforeAll(() => {
	({ sqlite, db: testDb } = createTestDb());
});

afterAll(() => {
	closeDb(sqlite);
});

function seedBase() {
	resetDb(sqlite);
	// 子供
	testDb.insert(schema.children).values({ nickname: 'テスト子', age: 4, theme: 'pink' }).run();
	// 活動（カテゴリ1: うんどう, カテゴリ2: べんきょう）
	testDb
		.insert(schema.activities)
		.values({ name: 'たいそう', categoryId: 1, icon: '🤸', basePoints: 5 })
		.run();
	testDb
		.insert(schema.activities)
		.values({ name: 'えほん', categoryId: 2, icon: '📖', basePoints: 5 })
		.run();
}

describe('calcStreakBonus（純粋関数テスト）', () => {
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

describe('recordActivity: 初回記録', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	it('初回記録で streakDays=1、streakBonus=0、ポイント付与', async () => {
		const result = assertSuccess(await recordActivity(1, 1, TENANT));
		expect(result.childId).toBe(1);
		expect(result.activityId).toBe(1);
		expect(result.streakDays).toBe(1);
		expect(result.streakBonus).toBe(0);
		expect(result.basePoints).toBe(5);
		expect(result.totalPoints).toBe(5); // base(5) + streak(0) + mastery(0)
		expect(result.activityName).toBe('たいそう');
	});

	it('同日同活動の2回目は ALREADY_RECORDED エラー（dailyLimit=null=1回制限）', async () => {
		assertSuccess(await recordActivity(1, 1, TENANT));
		const result = await recordActivity(1, 1, TENANT);
		expect(result).toEqual({ error: 'ALREADY_RECORDED' });
	});

	it('別活動なら同日に記録可能', async () => {
		assertSuccess(await recordActivity(1, 1, TENANT));
		const result2 = assertSuccess(await recordActivity(1, 2, TENANT));
		expect(result2.activityId).toBe(2);
		expect(result2.activityName).toBe('えほん');
	});

	it('存在しない子供は NOT_FOUND エラー', async () => {
		const result = await recordActivity(999, 1, TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'child' });
	});

	it('存在しない活動は NOT_FOUND エラー', async () => {
		const result = await recordActivity(1, 999, TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'activity' });
	});
});

describe('recordActivity: 連続日数（streak）', () => {
	beforeEach(() => {
		seedBase();
	});

	it('3日連続記録で streak が正しく増加する', async () => {
		mockToday = '2026-02-18';
		const day1 = assertSuccess(await recordActivity(1, 1, TENANT));
		expect(day1.streakDays).toBe(1);
		expect(day1.streakBonus).toBe(0);

		mockToday = '2026-02-19';
		const day2 = assertSuccess(await recordActivity(1, 1, TENANT));
		expect(day2.streakDays).toBe(2);
		expect(day2.streakBonus).toBe(1);

		mockToday = '2026-02-20';
		const day3 = assertSuccess(await recordActivity(1, 1, TENANT));
		expect(day3.streakDays).toBe(3);
		expect(day3.streakBonus).toBe(2);
	});

	it('1日空けると streak がリセットされる', async () => {
		mockToday = '2026-02-18';
		assertSuccess(await recordActivity(1, 1, TENANT));

		// 2/19 をスキップ
		mockToday = '2026-02-20';
		const result = assertSuccess(await recordActivity(1, 1, TENANT));
		expect(result.streakDays).toBe(1); // リセット
		expect(result.streakBonus).toBe(0);
	});

	it('別活動は独立した streak を持つ', async () => {
		mockToday = '2026-02-18';
		assertSuccess(await recordActivity(1, 1, TENANT)); // たいそう day1
		assertSuccess(await recordActivity(1, 2, TENANT)); // えほん day1

		mockToday = '2026-02-19';
		const taisou = assertSuccess(await recordActivity(1, 1, TENANT)); // たいそう day2
		expect(taisou.streakDays).toBe(2);
		expect(taisou.streakBonus).toBe(1);

		const ehon = assertSuccess(await recordActivity(1, 2, TENANT)); // えほん day2
		expect(ehon.streakDays).toBe(2);
		expect(ehon.streakBonus).toBe(1);
	});
});

describe('recordActivity: ポイントとXP', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	it('totalPoints はベースポイント + streakBonus + masteryBonus の合計', async () => {
		const result = assertSuccess(await recordActivity(1, 1, TENANT));
		// 初回: base=5, streak=0, mastery=0
		expect(result.totalPoints).toBe(result.basePoints + result.streakBonus + result.masteryBonus);
	});

	it('XP がカテゴリに蓄積される', async () => {
		const result = assertSuccess(await recordActivity(1, 1, TENANT));
		// xpGain.xpAfter > 0
		expect(result.xpGain.categoryId).toBe(1); // うんどう
		expect(result.xpGain.xpAfter).toBeGreaterThan(0);
		expect(result.xpGain.xpAfter).toBe(result.xpGain.xpBefore + result.totalPoints);
	});

	it('ポイント台帳に activity タイプのエントリが作成される', async () => {
		await recordActivity(1, 1, TENANT);
		const ledger = testDb.select().from(schema.pointLedger).all();
		expect(ledger.length).toBeGreaterThanOrEqual(1);
		const activityEntry = ledger.find((e) => e.type === 'activity');
		expect(activityEntry).toBeDefined();
		expect(activityEntry?.amount).toBe(5);
		expect(activityEntry?.childId).toBe(1);
	});
});

describe('recordActivity: dailyLimit', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	it('dailyLimit=2 の活動は同日2回まで記録可能', async () => {
		// dailyLimit=2 の活動を追加
		testDb
			.insert(schema.activities)
			.values({ name: 'はみがき', categoryId: 3, icon: '🪥', basePoints: 3, dailyLimit: 2 })
			.run();
		const activities = testDb.select().from(schema.activities).all();
		const hamigaki = activities.find((a) => a.name === 'はみがき');
		if (!hamigaki) throw new Error('はみがき not found');

		const r1 = assertSuccess(await recordActivity(1, hamigaki.id, TENANT));
		expect(r1.activityName).toBe('はみがき');

		const r2 = assertSuccess(await recordActivity(1, hamigaki.id, TENANT));
		expect(r2.activityName).toBe('はみがき');

		// 3回目はエラー
		const r3 = await recordActivity(1, hamigaki.id, TENANT);
		expect(r3).toEqual({ error: 'DAILY_LIMIT_REACHED' });
	});

	it('dailyLimit=0 の活動は無制限に記録可能', async () => {
		testDb
			.insert(schema.activities)
			.values({ name: 'おそうじ', categoryId: 3, icon: '🧹', basePoints: 3, dailyLimit: 0 })
			.run();
		const activities = testDb.select().from(schema.activities).all();
		const osouji = activities.find((a) => a.name === 'おそうじ');
		if (!osouji) throw new Error('おそうじ not found');

		// 5回連続で記録できる
		for (let i = 0; i < 5; i++) {
			const result = assertSuccess(await recordActivity(1, osouji.id, TENANT));
			expect(result.activityName).toBe('おそうじ');
		}
	});
});

describe('cancelActivityLog', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	it('キャンセルでポイントが返還される', async () => {
		const recorded = assertSuccess(await recordActivity(1, 1, TENANT));

		// CANCEL_WINDOW_MS 内にキャンセル
		const cancelResult = await cancelActivityLog(recorded.id, TENANT);
		if ('error' in cancelResult) {
			throw new Error(`Unexpected error: ${cancelResult.error}`);
		}
		expect(cancelResult.refundedPoints).toBe(recorded.totalPoints);
	});

	it('キャンセル後にポイント台帳にマイナスエントリが追加される', async () => {
		const recorded = assertSuccess(await recordActivity(1, 1, TENANT));
		await cancelActivityLog(recorded.id, TENANT);

		const ledger = testDb.select().from(schema.pointLedger).all();
		const cancelEntry = ledger.find((e) => e.type === 'cancel');
		expect(cancelEntry).toBeDefined();
		expect(cancelEntry?.amount).toBe(-recorded.totalPoints);
	});

	it('存在しないログIDは NOT_FOUND エラー', async () => {
		const result = await cancelActivityLog(9999, TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('キャンセル済みのログは NOT_FOUND エラー', async () => {
		const recorded = assertSuccess(await recordActivity(1, 1, TENANT));
		await cancelActivityLog(recorded.id, TENANT);

		const result = await cancelActivityLog(recorded.id, TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});
});

describe('recordActivity: 習熟度（mastery）', () => {
	beforeEach(() => {
		seedBase();
	});

	it('初回記録で習熟レベル1、習熟ボーナス0', async () => {
		mockToday = '2026-02-20';
		const result = assertSuccess(await recordActivity(1, 1, TENANT));
		expect(result.masteryLevel).toBe(1);
		expect(result.masteryBonus).toBe(0);
		expect(result.masteryLeveledUp).toBeNull();
	});

	it('5回記録するとレベル2に上がる', async () => {
		// 5日連続で記録（レベル2のしきい値=5回）
		let lastResult: RecordActivityResult | undefined;
		for (let i = 0; i < 5; i++) {
			mockToday = `2026-02-${String(20 + i).padStart(2, '0')}`;
			lastResult = assertSuccess(await recordActivity(1, 1, TENANT));
		}
		if (!lastResult) throw new Error('No result');
		expect(lastResult.masteryLevel).toBe(2);
		expect(lastResult.masteryLeveledUp).not.toBeNull();
		expect(lastResult.masteryLeveledUp?.newLevel).toBe(2);
	});
});

describe('recordActivity: 戻り値の構造', () => {
	beforeEach(() => {
		seedBase();
		mockToday = '2026-02-20';
	});

	it('必須フィールドが全て含まれる', async () => {
		const result = assertSuccess(await recordActivity(1, 1, TENANT));
		// 必須フィールドの存在確認
		expect(typeof result.id).toBe('number');
		expect(result.childId).toBe(1);
		expect(result.activityId).toBe(1);
		expect(typeof result.activityName).toBe('string');
		expect(typeof result.basePoints).toBe('number');
		expect(typeof result.streakDays).toBe('number');
		expect(typeof result.streakBonus).toBe('number');
		expect(typeof result.masteryBonus).toBe('number');
		expect(typeof result.masteryLevel).toBe('number');
		expect(typeof result.totalPoints).toBe('number');
		expect(typeof result.recordedAt).toBe('string');
		expect(typeof result.cancelableUntil).toBe('string');
		expect(Array.isArray(result.unlockedAchievements)).toBe(true);
		expect(result.xpGain).toBeDefined();
		expect(typeof result.xpGain.categoryId).toBe('number');
		expect(typeof result.xpGain.xpBefore).toBe('number');
		expect(typeof result.xpGain.xpAfter).toBe('number');
	});

	it('cancelableUntil は recordedAt より後の時刻', async () => {
		const result = assertSuccess(await recordActivity(1, 1, TENANT));
		const recordedTime = new Date(result.recordedAt).getTime();
		const cancelTime = new Date(result.cancelableUntil).getTime();
		expect(cancelTime).toBeGreaterThan(recordedTime);
	});
});
