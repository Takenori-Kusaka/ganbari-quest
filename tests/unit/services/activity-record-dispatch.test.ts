import { asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';
// tests/unit/services/activity-record-dispatch.test.ts
// EPIC #3424 / 実装 #3541 Phase Z (+ #3550 ①) / 設計 SSOT: dsql-data-model.md §8
//
// recordActivity の DATA_SOURCE=dsql dispatch 結線テスト:
//   [D1] sqlite 経路の regression 凍結: isDsqlBackend=false では従来どおり sqlite repo に
//        書き込み、recordActivityCore は一切呼ばれない
//   [D2] dsql 経路: recordActivityCore が「bonus 計算結果込みの正しい Input」で呼ばれ、
//        core Result が RecordActivityResult に写像される (確定値のみ描画、§8 演出契約)。
//        sqlite 側 activity_logs には書かれない (書込は core 単一 txn のみ)
//   [D3] error 契約: core の ALREADY_RECORDED / DAILY_LIMIT_REACHED が両経路と同一 shape で返る
//   [D4] NOT_FOUND guard は core 呼び出し前に short-circuit する (read-only 事前 guard 共有)
//   [D5] optional 失敗の隔離: optional 書込が throw しても core 結果 (成功 result) を壊さず、
//        fitness#11 counter (logger.error + Discord alert) に emit される (#3550 ①)
//   [D6] levelUp / masteryLeveledUp が core 確定値から組み立てられる

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { calcLevelFromXp } from '../../../src/lib/domain/validation/status';
import type { RecordActivityCoreResult } from '../../../src/lib/server/db/dsql/record-activity-core';
import * as schema from '../../../src/lib/server/db/schema';
import { assertSuccess } from '../helpers/assert-result';
import {
	closeDb,
	createTestDb,
	resetDb,
	seedChildActivities,
	type TestDb,
	type TestSqlite,
} from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

// dispatch 切替 flag (vi.mock は hoist されるため vi.hoisted で共有)
const h = vi.hoisted(() => ({ isDsql: false }));

// todayDate をモックして日付を制御 (既存 activity-log-service.test.ts と同一 pattern)
const mockToday = '2026-02-20';
vi.mock('$lib/domain/date-utils', async (importOriginal) => ({
	// 部分 mock。今日だけを固定し、他の JST ヘルパは実装をそのまま使う (#4127)
	...(await importOriginal<typeof import('$lib/domain/date-utils')>()),
	todayDateJST: () => mockToday,
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

// backend 判定のみ差し替え (resolveDbBackend 等は原本のまま)
vi.mock('$lib/server/db/backend', async (importOriginal) => {
	const orig = await importOriginal<typeof import('../../../src/lib/server/db/backend')>();
	return { ...orig, isPgBackend: () => h.isDsql };
});

// #4720: pg 専用経路は factory の getPgTransactionRunner から runner 注入を受ける (dsql/connection 直 import 廃止)。
// sqlite test-db 上で dispatch を検証するため runner だけダミー化する (core 自体を mock するため未使用)。
vi.mock('$lib/server/db/factory', async (importOriginal) => {
	const orig = await importOriginal<typeof import('../../../src/lib/server/db/factory')>();
	return {
		...orig,
		getPgTransactionRunner: () => ({
			runInTransaction: async <T>(work: (tx: unknown) => Promise<T>) => work({}),
		}),
	};
});

// DSQL 接続層: 実 pool を張らないダミー runner (core 自体を mock するため未使用)
vi.mock('$lib/server/db/dsql/connection', () => ({
	getDsqlDb: vi.fn(),
	getDsqlTransactionRunner: vi.fn(() => ({
		runInTransaction: async <T>(work: (tx: unknown) => Promise<T>) => work({}),
	})),
}));

// core 単一 txn を mock (Input 検証 + Result 写像検証の要)
vi.mock('$lib/server/db/dsql/record-activity-core', () => ({
	recordActivityCore: vi.fn(),
}));

// optional の 1 項目 (challenge 進捗) を制御可能にする ([D5] 隔離検証用)
vi.mock('$lib/server/services/child-challenge-service', () => ({
	updateChildChallengeProgress: vi.fn(async () => []),
}));

// ロガー / Discord alert (fitness#11 emit の観測点)
vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));
vi.mock('$lib/server/discord-alert', () => ({
	sendDiscordAlert: vi.fn(async () => undefined),
}));

import { recordActivityCore } from '../../../src/lib/server/db/dsql/record-activity-core';
import { sendDiscordAlert } from '../../../src/lib/server/discord-alert';
import { logger } from '../../../src/lib/server/logger';
// サービス層をインポート（モック設定後に行う）
import { recordActivity } from '../../../src/lib/server/services/activity-log-service';
import { updateChildChallengeProgress } from '../../../src/lib/server/services/child-challenge-service';

const TENANT = 'test-tenant';
const coreMock = vi.mocked(recordActivityCore);
const challengeMock = vi.mocked(updateChildChallengeProgress);

/** core 成功 Result の既定値 (base 5 / bonus 0 の初回記録相当)。 */
function coreOk(over: Partial<Extract<RecordActivityCoreResult, { ok: true }>> = {}) {
	return {
		ok: true as const,
		logId: 'core-log-1',
		totalPoints: 5,
		masteryCount: 1,
		masteryLevel: 1,
		totalXp: 5,
		statusLevel: 1,
		...over,
	};
}

beforeAll(() => {
	({ sqlite, db: testDb } = createTestDb());
});

afterAll(() => {
	closeDb(sqlite);
});

function seedBase() {
	resetDb(sqlite);
	testDb.insert(schema.children).values({ nickname: 'テスト子', age: 4, theme: 'pink' }).run();
	seedChildActivities(testDb, 1, [
		{ name: 'たいそう', categoryId: asCategoryId(1), icon: '🤸', basePoints: 5 },
		{ name: 'えほん', categoryId: asCategoryId(2), icon: '📖', basePoints: 5 },
	]);
}

beforeEach(() => {
	seedBase();
	h.isDsql = false;
	vi.clearAllMocks();
	coreMock.mockResolvedValue(coreOk());
	challengeMock.mockResolvedValue([]);
});

describe('[D1] sqlite 経路の regression 凍結 (isDsqlBackend=false)', () => {
	it('従来どおり sqlite repo に書き込み、recordActivityCore は呼ばれない', async () => {
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(result.basePoints).toBe(5);
		expect(result.totalPoints).toBe(5);
		expect(result.activityName).toBe('たいそう');
		// sqlite 側に activity_logs / point_ledger が実在する (従来経路の書込)
		expect(testDb.select().from(schema.activityLogs).all()).toHaveLength(1);
		expect(
			testDb
				.select()
				.from(schema.pointLedger)
				.all()
				.filter((e) => e.type === 'activity'),
		).toHaveLength(1);
		// core は dsql 経路専用 (dispatch されていない)
		expect(coreMock).not.toHaveBeenCalled();
	});

	it('ledger description は抽出後も従来書式 (計算部共有の出力不変担保)', async () => {
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		const entry = testDb
			.select()
			.from(schema.pointLedger)
			.all()
			.find((e) => e.type === 'activity');
		// 初回: streakBonus 0 / masteryBonus 0 → 活動名のみ (旧インライン実装と同一書式)
		expect(entry?.description).toBe('たいそう');
	});
});

describe('[D2] dsql 経路: core Input / Result 写像', () => {
	beforeEach(() => {
		h.isDsql = true;
	});

	it('recordActivityCore が bonus 計算結果込みの Input で 1 回呼ばれる', async () => {
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(coreMock).toHaveBeenCalledTimes(1);
		const [runner, input] = coreMock.mock.calls[0] ?? [];
		expect(runner).toBeDefined();
		expect(input).toMatchObject({
			familyId: TENANT,
			childId: '1',
			activityId: '1',
			categoryId: '1',
			basePoints: 5,
			streakBonus: 0,
			masteryBonus: 0,
			streakDays: 1,
			recordedDate: mockToday,
			dailyLimit: null,
			description: 'たいそう',
			changeType: 'activity_record',
		});
		// sync 注入関数は domain の正規計算と一致する (fitness#7: work 内 await 禁止のため関数注入)
		expect(input?.masteryLevelFor(4)).toBe(1);
		expect(input?.masteryLevelFor(5)).toBe(2);
		expect(input?.statusLevelFor(0)).toBe(calcLevelFromXp(0).level);
		expect(input?.statusLevelFor(5000)).toBe(calcLevelFromXp(5000).level);
	});

	it('core Result が RecordActivityResult に写像され、sqlite 側には書かれない', async () => {
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(result.id).toBe('core-log-1');
		expect(result.totalPoints).toBe(5);
		expect(result.masteryLevel).toBe(1);
		expect(result.masteryLeveledUp).toBeNull();
		expect(result.levelUp).toBeNull();
		expect(result.xpGain).toMatchObject({
			categoryId: asCategoryId(1),
			xpBefore: 0,
			xpAfter: 5,
			levelBefore: 1,
			levelAfter: 1,
			maxValue: 100000,
		});
		expect(result.unlockedAchievements).toEqual([]);
		expect(result.eventMissions).toEqual([]);
		expect(result.customUnlocked).toEqual([]);
		// 書込は core 単一 txn のみ: sqlite 側 activity_logs / point_ledger は 0 行
		expect(testDb.select().from(schema.activityLogs).all()).toHaveLength(0);
		expect(testDb.select().from(schema.pointLedger).all()).toHaveLength(0);
	});

	it('[D6] core 確定値から levelUp / masteryLeveledUp を組み立てる', async () => {
		// totalXp 5000 で必ず levelBefore < levelAfter になるよう core 値を設定
		const xpAfter = 5000;
		const totalPoints = 5;
		coreMock.mockResolvedValue(
			coreOk({ totalPoints, totalXp: xpAfter, masteryCount: 5, masteryLevel: 2, statusLevel: 9 }),
		);
		const expectedBefore = calcLevelFromXp(xpAfter - totalPoints);
		const expectedAfter = calcLevelFromXp(xpAfter);
		expect(expectedAfter.level).toBeGreaterThan(0); // sanity

		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(result.masteryLevel).toBe(2);
		expect(result.masteryLeveledUp).toEqual({
			oldLevel: 1,
			newLevel: 2,
			isMilestone: false,
		});
		if (expectedAfter.level > expectedBefore.level) {
			expect(result.levelUp).toMatchObject({
				oldLevel: expectedBefore.level,
				newLevel: expectedAfter.level,
				categoryId: asCategoryId(1),
			});
		} else {
			expect(result.levelUp).toBeNull();
		}
		expect(result.xpGain.xpBefore).toBe(xpAfter - totalPoints);
		expect(result.xpGain.xpAfter).toBe(xpAfter);
	});
});

describe('[D3] error 契約は両経路で同一 shape', () => {
	beforeEach(() => {
		h.isDsql = true;
	});

	it('core の ALREADY_RECORDED は { error } shape に写像される', async () => {
		coreMock.mockResolvedValue({ ok: false, reason: 'ALREADY_RECORDED' });
		const result = await recordActivity(asChildId(1), asActivityId(1), TENANT);
		expect(result).toEqual({ error: 'ALREADY_RECORDED' });
	});

	it('core の DAILY_LIMIT_REACHED も同様', async () => {
		coreMock.mockResolvedValue({ ok: false, reason: 'DAILY_LIMIT_REACHED' });
		const result = await recordActivity(asChildId(1), asActivityId(1), TENANT);
		expect(result).toEqual({ error: 'DAILY_LIMIT_REACHED' });
	});
});

describe('[D4] NOT_FOUND guard は core 前に short-circuit', () => {
	beforeEach(() => {
		h.isDsql = true;
	});

	it('存在しない child は NOT_FOUND で core 未呼出', async () => {
		const result = await recordActivity(asChildId(999), asActivityId(1), TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'child' });
		expect(coreMock).not.toHaveBeenCalled();
	});

	it('child 越境 activity は NOT_FOUND で core 未呼出 (CWE-598 guard 共有)', async () => {
		const result = await recordActivity(asChildId(1), asActivityId(999), TENANT);
		expect(result).toEqual({ error: 'NOT_FOUND', target: 'activity' });
		expect(coreMock).not.toHaveBeenCalled();
	});
});

describe('[D5] optional 失敗の隔離 + fitness#11 counter emit (#3550 ①)', () => {
	beforeEach(() => {
		h.isDsql = true;
	});

	it('optional (challenge 進捗) が throw しても core 成功 result を壊さない', async () => {
		challengeMock.mockRejectedValueOnce(new Error('challenge write failed'));
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		// core 確定値はそのまま返り、失敗した optional field は空 fallback
		expect(result.id).toBe('core-log-1');
		expect(result.totalPoints).toBe(5);
		expect(result.siblingChallenges).toEqual([]);
	});

	it('欠落は logger.error (構造化 kind/name/childId/tenantId/cause) + Discord alert に emit される', async () => {
		challengeMock.mockRejectedValueOnce(new Error('challenge write failed'));
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));

		const errorCalls = vi.mocked(logger.error).mock.calls;
		const emitted = errorCalls.find(
			([, meta]) =>
				(meta?.context as Record<string, unknown> | undefined)?.kind === 'optional-write-failed',
		);
		expect(emitted, 'fitness#11 counter (logger.error) が emit されていない').toBeDefined();
		expect(emitted?.[1]).toMatchObject({
			tenantId: TENANT,
			context: {
				kind: 'optional-write-failed',
				name: 'challenge_progress',
				childId: '1',
				cause: 'challenge write failed',
			},
		});

		expect(vi.mocked(sendDiscordAlert)).toHaveBeenCalledWith(
			expect.objectContaining({
				level: 'error',
				message: expect.stringContaining('challenge_progress'),
			}),
		);

		// #4192 (#4174 Q3): Discord は外部 SaaS なので tenantId は載せない。
		// 「どの家族か」は直前に assert した logger.error (tenantId 付き) 側で引く。
		const alertArg = vi.mocked(sendDiscordAlert).mock.calls[0]?.[0] as
			| Record<string, unknown>
			| undefined;
		expect(alertArg).toBeDefined();
		expect(alertArg).not.toHaveProperty('tenantId');
		expect(JSON.stringify(alertArg)).not.toContain(TENANT);
	});

	it('optional が成功する場合は counter を emit しない (偽陽性なし)', async () => {
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		const emitted = vi
			.mocked(logger.error)
			.mock.calls.find(
				([, meta]) =>
					(meta?.context as Record<string, unknown> | undefined)?.kind === 'optional-write-failed',
			);
		expect(emitted).toBeUndefined();
		expect(vi.mocked(sendDiscordAlert)).not.toHaveBeenCalled();
	});
});
