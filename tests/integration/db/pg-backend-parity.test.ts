// tests/integration/db/pg-backend-parity.test.ts
// #4719: 本番 backend (pg-core = cloud DSQL / NUC PGlite) でだけ壊れていた 3 箇所の再現 → 是正を、
// 実 migration (drizzle/pglite/) を適用した PGlite + factory (DATA_SOURCE=pglite) + service 層の
// 貫通で固定する (sqlite では再現しない class、#4680)。
//
//   [U1] 使用時間ログ: startUsageSession → endUsageSession → 本日 / 今週サマリーに分が入る
//        (旧: facade が sqlite 固定 import で pg では表未作成 throw → WARN + 0 分)
//   [R1] ホーム / 月次レポートの「レベル」が statuses のレベルと一致する
//        (旧: dsql compute-on-read summary の level 既定 1 を report-service がそのまま採用)
//   [C1] checklist export の sourcePresetId が入る
//        (旧: dsql findTemplatesByChild の SELECT 列に source_preset_id が無い)

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { asCategoryId, type asChildId } from '../../../src/lib/domain/ids';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const TENANT = '00000000-0000-4000-8000-00000000a719';
const originalDataSource = process.env.DATA_SOURCE;
const originalDataDir = process.env.PGLITE_DATA_DIR;

type PgliteConn = typeof import('../../../src/lib/server/db/pglite/connection');
let pgliteConn: PgliteConn;
let repos: ReturnType<typeof import('../../../src/lib/server/db/factory').getRepos>;
let childId: ReturnType<typeof asChildId>;

beforeAll(async () => {
	vi.resetModules();
	process.env.DATA_SOURCE = 'pglite';
	delete process.env.PGLITE_DATA_DIR;
	pgliteConn = await import('../../../src/lib/server/db/pglite/connection');
	await pgliteConn.resetPgliteConnectionForTesting();
	await pgliteConn.initPgliteConnection();
	const { getRepos } = await import('../../../src/lib/server/db/factory');
	repos = getRepos();
	const child = await repos.child.insertChild({ nickname: 'ぱりてぃ', age: 8 }, TENANT);
	childId = child.id;
}, 120_000);

afterAll(async () => {
	await pgliteConn?.resetPgliteConnectionForTesting();
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
	if (originalDataDir === undefined) delete process.env.PGLITE_DATA_DIR;
	else process.env.PGLITE_DATA_DIR = originalDataDir;
});

describe('#4719 pg-core backend parity (PGlite 実 migration)', () => {
	it('[U1] 使用時間ログが pg に記録され、本日 / 今週サマリーに分が入る (WARN なし)', async () => {
		const { logger } = await import('$lib/server/logger');
		const svc = await import('../../../src/lib/server/services/usage-log-service');

		const started = await svc.startUsageSession(TENANT, childId);
		expect(started).not.toBeNull();
		expect(started?.id).toMatch(/^[0-9a-f-]{36}$/);

		// 開始時刻を 10 分前に戻して終了 → durationSec ≈ 600
		const db = await pgliteConn.getPgliteDb();
		const { sql } = await import('drizzle-orm');
		await db.execute(
			sql`UPDATE usage_logs SET started_at = now() - interval '10 minutes' WHERE family_id = ${TENANT}`,
		);
		const ended = await svc.endUsageSession(started?.id ?? '', TENANT);
		expect(ended?.durationSec).toBeGreaterThanOrEqual(599);

		const today = await svc.getTodayUsageSummary(TENANT, [{ id: childId, nickname: 'ぱりてぃ' }]);
		expect(today[0]?.durationMin).toBe(10);

		const weekly = await svc.getWeeklyUsageSummary(TENANT, childId);
		expect(weekly).toHaveLength(7);
		expect(weekly.reduce((s, e) => s + e.durationMin, 0)).toBe(10);

		// 旧実装の兆候 (「セッション開始記録に失敗」WARN) が出ていない
		expect(vi.mocked(logger.warn)).not.toHaveBeenCalledWith(
			expect.stringContaining('[usage-log]'),
			expect.anything(),
		);

		// 2 回目の開始で進行中セッションが閉じられる (closeOpenSessions の pg 実装)
		const second = await svc.startUsageSession(TENANT, childId);
		expect(second?.id).not.toBe(started?.id);
		const open = await db.execute(
			sql`SELECT count(*)::int AS c FROM usage_logs WHERE family_id = ${TENANT} AND ended_at IS NULL`,
		);
		expect((open.rows[0] as { c: number }).c).toBe(1);
	});

	it('[R1] ホーム簡易サマリー / 月次レポートのレベルが statuses と一致する', async () => {
		const { todayDateJST } = await import('../../../src/lib/domain/date-utils');
		const today = todayDateJST();
		const yearMonth = today.slice(0, 7);

		// 活動 5 回 (summary 経路に乗せる: compute-on-read summary は非 cancelled log がある日に行を作る)
		const act = await repos.childActivity.insertActivity(
			{ childId, name: 'はみがき', categoryId: asCategoryId('life'), icon: '🦷', basePoints: 42 },
			TENANT,
		);
		for (let i = 0; i < 5; i++) {
			await repos.activity.insertActivityLog(
				{
					childId,
					activityId: act.id,
					points: 42,
					streakDays: 1,
					streakBonus: 0,
					recordedDate: today,
					recordedAt: new Date().toISOString(),
				},
				TENANT,
			);
		}
		// status: level 6 (活動 5 回 210P 相当)
		await repos.status.upsertStatus(childId, asCategoryId('life'), 210, 6, 210, TENANT);

		const summaries = await repos.reportDailySummary.findByChildAndDateRange(
			childId,
			`${yearMonth}-01`,
			today,
			TENANT,
		);
		expect(summaries.length).toBeGreaterThan(0); // summary 経路に乗っていること

		const report = await import('../../../src/lib/server/services/report-service');
		const simple = await report.getSimpleMonthSummary(TENANT, childId, yearMonth);
		expect(simple.currentLevel).toBe(6);
		expect(simple.totalActivities).toBe(5);

		// #4697: 台帳に当月の獲得を 2 件入れる。「ポイント」は台帳のその月の獲得合計であり、
		// statuses の XP 累計とは別の量になった (pg-core 実装 sumEarnedPointsBetween の疎通も兼ねる)。
		await repos.point.insertPointEntry(
			{ childId, amount: 42, type: 'activity', description: 'はみがき' },
			TENANT,
		);
		await repos.point.insertPointEntry(
			{ childId, amount: 26, type: 'activity', description: 'はみがき' },
			TENANT,
		);

		const detailed = await report.computeDetailedMonthlyReport(
			TENANT,
			childId,
			'ぱりてぃ',
			yearMonth,
		);
		expect(detailed.currentLevel).toBe(6);
		// #4697: XP 累計は statuses から realtime 導出 (#4719 の意図はこちらに移動)
		expect(detailed.totalXp).toBe(210);
		// #4697: ポイントは当月の台帳獲得合計 (42 + 26)。XP 累計 (210) とは一致しない
		expect(detailed.totalPoints).toBe(68);
		expect(detailed.isFuture).toBe(false);
		expect(detailed.totalActivities).toBe(5);
	});

	it('[C1] checklist の sourcePresetId が findTemplatesByChild / export に入る', async () => {
		const tpl = await repos.checklist.insertTemplate(
			{ name: 'あさのしたく', sourcePresetId: 'preset-morning-1' },
			TENANT,
		);
		await repos.checklist.assignTemplateToChildren(tpl.id, [childId], TENANT);

		const byChild = await repos.checklist.findTemplatesByChild(childId, TENANT, true, true);
		expect(byChild.find((t) => t.id === tpl.id)?.sourcePresetId).toBe('preset-morning-1');

		const { exportFamilyData } = await import('../../../src/lib/server/services/export-service');
		const exported = await exportFamilyData({ tenantId: TENANT });
		const exportedTpl = exported.data.checklistTemplates.find((t) => t.name === 'あさのしたく');
		expect(exportedTpl?.sourcePresetId).toBe('preset-morning-1');
	});
});
