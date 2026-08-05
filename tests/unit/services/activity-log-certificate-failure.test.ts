// tests/unit/services/activity-log-certificate-failure.test.ts
// #4261 ①: 証明書発行ブロックの失敗を握りつぶさないことの回帰テスト。
//
// このブロックは月間の習慣化証明書 (#4172) の発行を含み、その中で `insertPointEntry` が
// **通貨 (ポイント / 思い出チケット) を発行する**。失敗が無ログだと「チケットがもらえていない」
// という問い合わせに対し、付与を試みたのか失敗したのかを後から判別できない。
//
// 本 test は「失敗 → ログが出る」を固定する。ログが消えたら赤になる (ADR-0006: assertion を
// 弱めて赤を消さない)。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';
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

const mockToday = '2026-02-20';
vi.mock('$lib/domain/date-utils', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/domain/date-utils')>()),
	todayDateJST: () => mockToday,
}));

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

const loggerError = vi.fn();
vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		error: (...args: unknown[]) => loggerError(...args),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

// Discord 通知は本 test の対象外 (payload の privacy は optional-write-alert.test.ts が担う)。
// 実 webhook fetch を張らないよう no-op に固定する。
vi.mock('$lib/server/discord-alert', () => ({
	sendDiscordAlert: vi.fn(async () => {}),
}));

// 証明書発行を**必ず失敗させる**。通貨付与 (insertPointEntry) を含む経路の失敗を模す。
const CERT_FAILURE_MESSAGE = 'certificate issue failed (test)';
vi.mock('$lib/server/services/certificate-service', () => ({
	checkAndIssueStreakCertificates: vi.fn(async () => {
		throw new Error(CERT_FAILURE_MESSAGE);
	}),
	checkAndIssueLevelCertificates: vi.fn(async () => {
		throw new Error(CERT_FAILURE_MESSAGE);
	}),
	issueCategoryMasterCertificate: vi.fn(async () => {
		throw new Error(CERT_FAILURE_MESSAGE);
	}),
	issueMonthlyHabitCertificateIfEligible: vi.fn(async () => {
		throw new Error(CERT_FAILURE_MESSAGE);
	}),
}));

import { recordActivity } from '../../../src/lib/server/services/activity-log-service';

const TENANT = 'test-tenant';

beforeAll(() => {
	({ sqlite, db: testDb } = createTestDb());
});

afterAll(() => {
	closeDb(sqlite);
});

beforeEach(() => {
	loggerError.mockClear();
	resetDb(sqlite);
	testDb.insert(schema.children).values({ nickname: 'テスト子', age: 8, theme: 'blue' }).run();
	seedChildActivities(testDb, 1, [
		{ name: 'たいそう', categoryId: asCategoryId(1), icon: '🤸', basePoints: 5 },
	]);
});

describe('recordActivity: 証明書発行 (通貨発行を含む) の失敗観測 (#4261 ①)', () => {
	it('証明書発行が失敗しても記録フロー自体は成功する（既存の隔離挙動を維持）', async () => {
		const result = assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));
		expect(result.totalPoints).toBe(5);
	});

	it('証明書発行が失敗したら logger.error に構造化ログが残る（握りつぶさない）', async () => {
		assertSuccess(await recordActivity(asChildId(1), asActivityId(1), TENANT));

		const failureLogs = loggerError.mock.calls.filter(
			(call) =>
				(call[1] as { context?: { kind?: string } })?.context?.kind === 'optional-write-failed',
		);
		expect(failureLogs).toHaveLength(1);

		const [, entry] = failureLogs[0] as [
			string,
			{ tenantId?: string; context?: { name?: string; childId?: string; cause?: string } },
		];
		// どの optional 書込が落ちたかが名前で分かる
		expect(entry.context?.name).toBe('certificate');
		// 「どの家族・どの子か」は認証された場所 (CloudWatch Logs) でだけ引ける (#4174 Q3 / #4192)
		expect(entry.tenantId).toBe(TENANT);
		expect(entry.context?.childId).toBe('1');
		// 原因が分かる (問い合わせ時の切り分けに直結する情報)
		expect(entry.context?.cause).toContain(CERT_FAILURE_MESSAGE);
	});
});
