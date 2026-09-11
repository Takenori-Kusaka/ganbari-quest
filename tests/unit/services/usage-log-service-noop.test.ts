import { asChildId } from '$lib/domain/ids';
/**
 * tests/unit/services/usage-log-service-noop.test.ts
 *
 * #4719: usage-log は backend 共通 interface (IUsageLogRepo) + factory 配線になった。
 * service 層は backend 分岐を持たず、facade (usage-log-repo.ts) が `getRepos().usageLog` に委譲する。
 *
 * 本テストは以下を検証する:
 *   1. DATA_SOURCE=demo (demo Lambda、ADR-0048) では demo stub repo が選ばれ、4 関数が throw せず
 *      安全な値 (dummy id / 0 分) を返す = 旧 #2338 no-op fallback と同じ顧客挙動を factory 経由で担保
 *   2. facade を mock した service 単体では、repo の結果を集計して返す / 例外は null に正規化 (graceful)
 *
 * pg-core (DSQL / PGlite) 実装の貫通は tests/integration/db/pg-backend-parity.test.ts が担う。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const TENANT = 'tenant-#2338';
const CHILDREN = [
	{ id: asChildId(901), nickname: 'みらいちゃん' },
	{ id: asChildId(903), nickname: 'けんたくん' },
];

const originalDataSource = process.env.DATA_SOURCE;

describe('usage-log-service × factory backend (#4719)', () => {
	afterEach(() => {
		if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
		else process.env.DATA_SOURCE = originalDataSource;
		vi.resetModules();
		vi.doUnmock('$lib/server/db/usage-log-repo');
	});

	describe('DATA_SOURCE=demo (demo stub repo、ADR-0048)', () => {
		beforeEach(() => {
			vi.resetModules();
			process.env.DATA_SOURCE = 'demo';
		});

		it('startUsageSession は dummy id を返す (永続化しない)', async () => {
			const { startUsageSession } = await import(
				'../../../src/lib/server/services/usage-log-service'
			);
			const result = await startUsageSession(TENANT, asChildId(901));
			expect(result?.id).toBe('0');
		});

		it('endUsageSession は行が無いので null (route は 204)', async () => {
			const { endUsageSession } = await import(
				'../../../src/lib/server/services/usage-log-service'
			);
			const result = await endUsageSession('0', TENANT);
			expect(result).toBeNull();
		});

		it('getTodayUsageSummary は全 child durationMin: 0', async () => {
			const { getTodayUsageSummary } = await import(
				'../../../src/lib/server/services/usage-log-service'
			);
			const result = await getTodayUsageSummary(TENANT, CHILDREN);
			expect(result).toEqual([
				{ childId: asChildId(901), childName: 'みらいちゃん', durationMin: 0 },
				{ childId: asChildId(903), childName: 'けんたくん', durationMin: 0 },
			]);
		});

		it('getWeeklyUsageSummary は直近 7 日の 0 分エントリ (昇順)', async () => {
			const { getWeeklyUsageSummary } = await import(
				'../../../src/lib/server/services/usage-log-service'
			);
			const result = await getWeeklyUsageSummary(TENANT, asChildId(901));
			expect(result).toHaveLength(7);
			expect(result.every((e) => e.durationMin === 0)).toBe(true);
			for (let i = 1; i < result.length; i++) {
				const curr = result[i];
				const prev = result[i - 1];
				if (!curr || !prev) continue;
				expect(curr.date > prev.date).toBe(true);
			}
		});
	});

	describe('facade mock (service 単体の集計 / graceful)', () => {
		let repo: typeof import('../../../src/lib/server/db/usage-log-repo');
		let svc: typeof import('../../../src/lib/server/services/usage-log-service');

		beforeEach(async () => {
			vi.resetModules();
			process.env.DATA_SOURCE = 'sqlite';
			vi.doMock('$lib/server/db/usage-log-repo', () => ({
				insertUsageLog: vi.fn(),
				updateUsageLogEnd: vi.fn(),
				closeOpenSessions: vi.fn(),
				findTodayUsageLogs: vi.fn(),
				findUsageLogsByChildAndDateRange: vi.fn(),
				deleteByTenantId: vi.fn(),
			}));
			repo = await import('../../../src/lib/server/db/usage-log-repo');
			svc = await import('../../../src/lib/server/services/usage-log-service');
		});

		it('startUsageSession は repo を呼び、insertUsageLog の結果を返す', async () => {
			vi.mocked(repo.closeOpenSessions).mockResolvedValue(undefined);
			vi.mocked(repo.insertUsageLog).mockResolvedValue({
				id: '42',
				tenantId: TENANT,
				childId: asChildId(901),
				startedAt: '2026-05-20T00:00:00Z',
				endedAt: null,
				durationSec: null,
			});

			const result = await svc.startUsageSession(TENANT, asChildId(901));
			expect(result?.id).toBe('42');
			expect(repo.closeOpenSessions).toHaveBeenCalledOnce();
			expect(repo.insertUsageLog).toHaveBeenCalledWith(
				expect.objectContaining({ tenantId: TENANT, childId: asChildId(901) }),
			);
		});

		it('startUsageSession は repo 例外時に null を返す (graceful)', async () => {
			vi.mocked(repo.closeOpenSessions).mockRejectedValue(new Error('SQLite locked'));
			const result = await svc.startUsageSession(TENANT, asChildId(901));
			expect(result).toBeNull();
		});

		it('getWeeklyUsageSummary は repo の結果を集計する', async () => {
			// 直近 7 日範囲内 (今日) の date を使う — 固定日付は時間経過で範囲外になり flake する (#2402)
			const today = new Date();
			today.setUTCHours(10, 0, 0, 0);
			const todayIso = today.toISOString();
			const endIso = new Date(today.getTime() + 30 * 60 * 1000).toISOString();
			vi.mocked(repo.findUsageLogsByChildAndDateRange).mockResolvedValue([
				{
					id: '1',
					tenantId: TENANT,
					childId: asChildId(901),
					startedAt: todayIso,
					endedAt: endIso,
					durationSec: 1800, // 30 分
				},
			]);
			const result = await svc.getWeeklyUsageSummary(TENANT, asChildId(901));
			expect(result).toHaveLength(7);
			expect(repo.findUsageLogsByChildAndDateRange).toHaveBeenCalledOnce();
			expect(result.some((e) => e.durationMin === 30)).toBe(true);
		});
	});
});
