/**
 * tests/unit/services/usage-log-service-dynamodb-noop.test.ts
 *
 * #2338 (2026-05-20): 本番 cognito Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で
 * `/api/v1/usage` POST / PATCH が 500 連続発生。usage-log-repo は SQLite のみ実装
 * (Pre-PMF: DynamoDB 対応不要、ADR-0010 Bucket B) のため、DATA_SOURCE=dynamodb 環境で
 * SQLite import → throw → endpoint 500 となっていた。
 *
 * 本テストは以下を検証する:
 *   1. DATA_SOURCE=dynamodb で 4 関数 (startUsageSession / endUsageSession /
 *      getTodayUsageSummary / getWeeklyUsageSummary) が no-op で動作 (throw せず、
 *      安全なダミー値を返す)
 *   2. DATA_SOURCE=demo でも同様に no-op
 *   3. DATA_SOURCE=sqlite (既定) では SQLite 経路を試みる (既存挙動維持)
 *
 * これにより、SQLite import の throw が endpoint まで到達せず、500 ではなく
 * 204 No Content (endpoint 側で `result === null` を 204 に変換) が返る経路を担保する。
 *
 * 関連:
 *   - ADR-0010 Pre-PMF Bucket B (まだ作らない)
 *   - ADR-0002 Critical 修正の品質ゲート
 *   - docs/rationale/07-usage-log-dynamodb-deferred-rationale.md (PMF 後 roadmap)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SQLite repo を mock (DATA_SOURCE=sqlite 経路のテストで使う)
vi.mock('$lib/server/db/usage-log-repo', () => ({
	insertUsageLog: vi.fn(),
	updateUsageLogEnd: vi.fn(),
	closeOpenSessions: vi.fn(),
	findTodayUsageLogs: vi.fn(),
	findUsageLogsByChildAndDateRange: vi.fn(),
	deleteByTenantId: vi.fn(),
}));

import * as repo from '../../../src/lib/server/db/usage-log-repo';
import {
	endUsageSession,
	getTodayUsageSummary,
	getWeeklyUsageSummary,
	resetNoopNotifiedForTesting,
	startUsageSession,
} from '../../../src/lib/server/services/usage-log-service';

const TENANT = 'tenant-#2338';
const CHILDREN = [
	{ id: 901, nickname: 'みらいちゃん' },
	{ id: 903, nickname: 'けんたくん' },
];

describe('#2338 hotfix: usage-log-service no-op fallback (DATA_SOURCE=dynamodb / demo)', () => {
	beforeEach(() => {
		resetNoopNotifiedForTesting();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe('DATA_SOURCE=dynamodb (本番 cognito Lambda)', () => {
		beforeEach(() => {
			vi.stubEnv('DATA_SOURCE', 'dynamodb');
		});

		it('startUsageSession は no-op で dummy id を返し、SQLite repo を呼ばない', async () => {
			const result = await startUsageSession(TENANT, 901);
			expect(result).toEqual({ id: 0 });
			expect(repo.insertUsageLog).not.toHaveBeenCalled();
			expect(repo.closeOpenSessions).not.toHaveBeenCalled();
		});

		it('endUsageSession は no-op で durationSec: 0 を返し、SQLite repo を呼ばない', async () => {
			const result = await endUsageSession(0, TENANT);
			expect(result).toEqual({ durationSec: 0 });
			expect(repo.updateUsageLogEnd).not.toHaveBeenCalled();
		});

		it('getTodayUsageSummary は no-op で全 child durationMin: 0 を返す', async () => {
			const result = await getTodayUsageSummary(TENANT, CHILDREN);
			expect(result).toEqual([
				{ childId: 901, childName: 'みらいちゃん', durationMin: 0 },
				{ childId: 903, childName: 'けんたくん', durationMin: 0 },
			]);
			expect(repo.findTodayUsageLogs).not.toHaveBeenCalled();
		});

		it('getWeeklyUsageSummary は no-op で直近 7 日の空エントリを返す', async () => {
			const result = await getWeeklyUsageSummary(TENANT, 901);
			expect(result).toHaveLength(7);
			expect(result.every((e) => e.durationMin === 0)).toBe(true);
			// 各エントリの date は YYYY-MM-DD 形式かつ昇順
			for (let i = 1; i < result.length; i++) {
				expect(result[i].date > result[i - 1].date).toBe(true);
			}
			expect(repo.findUsageLogsByChildAndDateRange).not.toHaveBeenCalled();
		});
	});

	describe('DATA_SOURCE=demo (demo Lambda、ADR-0048)', () => {
		beforeEach(() => {
			vi.stubEnv('DATA_SOURCE', 'demo');
		});

		it('startUsageSession は no-op で dummy id を返す', async () => {
			const result = await startUsageSession(TENANT, 901);
			expect(result).toEqual({ id: 0 });
			expect(repo.insertUsageLog).not.toHaveBeenCalled();
		});

		it('getTodayUsageSummary は no-op で全 child durationMin: 0 を返す', async () => {
			const result = await getTodayUsageSummary(TENANT, CHILDREN);
			expect(result.every((e) => e.durationMin === 0)).toBe(true);
			expect(repo.findTodayUsageLogs).not.toHaveBeenCalled();
		});
	});

	describe('DATA_SOURCE=sqlite (既定、NUC local / dev)', () => {
		beforeEach(() => {
			vi.stubEnv('DATA_SOURCE', 'sqlite');
		});

		it('startUsageSession は SQLite repo を呼び、insertUsageLog の結果を返す', async () => {
			vi.mocked(repo.closeOpenSessions).mockResolvedValue(undefined);
			vi.mocked(repo.insertUsageLog).mockResolvedValue({ id: 42 });

			const result = await startUsageSession(TENANT, 901);
			expect(result).toEqual({ id: 42 });
			expect(repo.closeOpenSessions).toHaveBeenCalledOnce();
			expect(repo.insertUsageLog).toHaveBeenCalledWith(
				expect.objectContaining({ tenantId: TENANT, childId: 901 }),
			);
		});

		it('startUsageSession は SQLite repo 例外時に null を返す (graceful)', async () => {
			vi.mocked(repo.closeOpenSessions).mockRejectedValue(new Error('SQLite locked'));

			const result = await startUsageSession(TENANT, 901);
			expect(result).toBeNull();
		});

		it('getWeeklyUsageSummary は SQLite repo の結果を集計する', async () => {
			vi.mocked(repo.findUsageLogsByChildAndDateRange).mockResolvedValue([
				{
					id: 1,
					tenantId: TENANT,
					childId: 901,
					startedAt: '2026-05-15T10:00:00Z',
					endedAt: '2026-05-15T10:30:00Z',
					durationSec: 1800, // 30 分
				},
			]);
			const result = await getWeeklyUsageSummary(TENANT, 901);
			expect(result).toHaveLength(7);
			expect(repo.findUsageLogsByChildAndDateRange).toHaveBeenCalledOnce();
			// 1 件 30 分のログが含まれる日の durationMin > 0 を期待
			expect(result.some((e) => e.durationMin === 30)).toBe(true);
		});
	});
});
