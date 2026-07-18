// tests/unit/services/synthetic-staging-seed-pglite.test.ts — 合成 staging seed の PGlite 流し込み検証 (#3412)
//
// buildSyntheticStagingDataset → applySyntheticDataset (scripts/lib/runtime/seed-staging-apply.ts)
// が実 PGlite (in-memory、実 migration 適用) に貫通することを機械検証する。CLI
// (scripts/seed-staging.ts apply) と同一 core を呼ぶため、この test が緑 = staging workflow の
// seed 経路が pg-core backend で成立することの実証になる (pglite-cutover-roundtrip.test.ts と同型)。
//
// staging 実機 (NUC #2872 / AWS #2873) での適用は deploy workflow の発火が必要なため本 test の
// 対象外 (統合 PR lane / #2873 lane で確認する)。

import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

const originalDataSource = process.env.DATA_SOURCE;

afterAll(() => {
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
});

describe('synthetic staging seed → PGlite apply (#3412)', () => {
	it('5 tenant (premium/free/trial×2/empty) が families + trial + 家族データ込みで seed され件数突合が一致する', async () => {
		process.env.DATA_SOURCE = 'pglite';
		delete process.env.PGLITE_DATA_DIR; // in-memory (実 migration = drizzle/pglite/ を適用)

		const { buildSyntheticStagingDataset } = await import(
			'../../../src/lib/server/demo/synthetic-staging-dataset'
		);
		const dataset = await buildSyntheticStagingDataset();

		const pgliteConn = await import('../../../src/lib/server/db/pglite/connection');
		await pgliteConn.resetPgliteConnectionForTesting();
		await pgliteConn.initPgliteConnection();

		try {
			const { applySyntheticDataset } = await import(
				'../../../scripts/lib/runtime/seed-staging-apply'
			);
			const db = pgliteConn.getPgliteDbSync();
			// applySyntheticDataset は import error / 件数突合不一致で throw する — 正常終了自体が検証
			const result = await applySyntheticDataset(dataset, db);
			expect(result.tenants.map((t) => t.key)).toEqual([
				'premium-family',
				'free',
				'trial-active',
				'trial-expired',
				'empty',
			]);

			// families 行 (plan 軸 D4): 5 tenant 分 + plan 値
			const famRows = await db.execute(
				sql`SELECT family_id, plan, status FROM families ORDER BY name`,
			);
			expect(famRows.rows.length).toBe(5);
			const planByUuid = new Map(
				(famRows.rows as { family_id: string; plan: string | null }[]).map((r) => [
					r.family_id,
					r.plan,
				]),
			);
			const byKey = new Map(dataset.tenants.map((t) => [t.key, t]));
			expect(planByUuid.get(byKey.get('premium-family')?.tenantUuid ?? '')).toBe('family-monthly');
			expect(planByUuid.get(byKey.get('free')?.tenantUuid ?? '')).toBeNull();

			// trial 行 (D6): active / expired の 2 tenant に trial_history が入る
			const trialRows = await db.execute(
				sql`SELECT family_id, tier, start_date, end_date FROM trial_history`,
			);
			expect(trialRows.rows.length).toBe(2);
			const trialByUuid = new Map(
				(trialRows.rows as { family_id: string; tier: string; end_date: string }[]).map((r) => [
					r.family_id,
					r,
				]),
			);
			expect(trialByUuid.get(byKey.get('trial-active')?.tenantUuid ?? '')?.tier).toBe('standard');
			expect(trialByUuid.get(byKey.get('trial-expired')?.tenantUuid ?? '')?.tier).toBe('family');

			// tenant A: がんばり家 5 人が repo 経由で読める (5 age mode 実データ)
			const { getRepos } = await import('../../../src/lib/server/db/factory');
			const repos = getRepos();
			const tenantAUuid = byKey.get('premium-family')?.tenantUuid ?? '';
			const childrenA = await repos.child.findAllChildren(tenantAUuid);
			expect(childrenA.length).toBe(5);
			expect(childrenA.map((c) => c.nickname).sort()).toEqual(
				['たろうくん', 'ひなちゃん', 'けんたくん', 'さくらちゃん', 'けいすけくん'].sort(),
			);

			// 空 tenant (D18): 子供 0 人 / 家族データ行なし
			const emptyUuid = byKey.get('empty')?.tenantUuid ?? '';
			expect((await repos.child.findAllChildren(emptyUuid)).length).toBe(0);

			// free tenant: 単独子 + 少量 log
			const freeUuid = byKey.get('free')?.tenantUuid ?? '';
			const childrenFree = await repos.child.findAllChildren(freeUuid);
			expect(childrenFree.map((c) => c.nickname)).toEqual(['まなぶくん']);

			// import counts が結果 summary に反映されている (件数突合済の値)
			const tenantAResult = result.tenants.find((t) => t.key === 'premium-family');
			expect(tenantAResult?.importedCounts?.children).toBe(5);
			expect(tenantAResult?.importedCounts?.activityLogs).toBeGreaterThanOrEqual(50);
		} finally {
			await pgliteConn.resetPgliteConnectionForTesting();
		}
	}, 180_000);
});
