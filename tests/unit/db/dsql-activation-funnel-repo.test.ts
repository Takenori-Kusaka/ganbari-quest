// tests/unit/db/dsql-activation-funnel-repo.test.ts
// EPIC #3424 / #3805: on-demand activation funnel の DSQL 実装テスト (実 schema PGlite)。
//
// 単一集約 SQL が families / children / activity_logs から 4 段 funnel 件数を正しく導出することを
// 実データで検証する。cohort 境界 (created_at range) / 子供有無 / 非取消活動のみ / retention 窓
// (signup + N 日以内) を網羅する。

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDsqlActivationFunnelRepo } from '../../../src/lib/server/db/dsql/activation-funnel-repo';
import type { IActivationFunnelRepo } from '../../../src/lib/server/db/interfaces/activation-funnel-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

// cohort 起点。この時刻以降に登録した家庭のみ funnel 対象。
const SINCE = '2026-07-01T00:00:00.000Z';
const RETENTION_DAYS = 7;

const ACTIVITY_ID = '00000000-0000-4000-8000-00000000a001';

// 家庭 6 種 (期待段は下の TDD list 参照)。
const FAM = {
	// 全 4 段: 子供あり + signup +3 日で活動 (retention 内)
	all: '00000000-0000-4000-8000-0000000000f1',
	// 段 1-3: 子供あり + signup +15 日で活動 (retention 外)
	late: '00000000-0000-4000-8000-0000000000f2',
	// 段 1-2: 子供あり + 活動なし
	child: '00000000-0000-4000-8000-0000000000f3',
	// 段 1: 子供なし
	signup: '00000000-0000-4000-8000-0000000000f4',
	// cohort 外: since より前に登録
	old: '00000000-0000-4000-8000-0000000000f5',
	// 段 1-2: 子供あり + 取消活動のみ (初回活動に数えない)
	cancelled: '00000000-0000-4000-8000-0000000000f6',
} as const;

const CHILD = {
	all: '00000000-0000-4000-8000-00000000c001',
	late: '00000000-0000-4000-8000-00000000c002',
	child: '00000000-0000-4000-8000-00000000c003',
	cancelled: '00000000-0000-4000-8000-00000000c006',
} as const;

describe('createDsqlActivationFunnelRepo (実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let repo: IActivationFunnelRepo;

	const insertFamily = (familyId: string, createdAt: string) =>
		t.db.execute(sql`
			INSERT INTO families (family_id, name, status, created_at)
			VALUES (${familyId}, ${'fam'}, ${'active'}, ${createdAt}::timestamptz)
		`);

	const insertChild = (familyId: string, childId: string) =>
		t.db.execute(sql`
			INSERT INTO children (family_id, child_id, nickname)
			VALUES (${familyId}, ${childId}, ${'child'})
		`);

	const insertActivity = (
		familyId: string,
		childId: string,
		recordedAt: string,
		cancelled: boolean,
	) =>
		t.db.execute(sql`
			INSERT INTO activity_logs
				(family_id, child_id, activity_id, points, recorded_date, recorded_at, cancelled)
			VALUES (${familyId}, ${childId}, ${ACTIVITY_ID}, ${10},
				${recordedAt.slice(0, 10)}, ${recordedAt}::timestamptz, ${cancelled})
		`);

	beforeAll(async () => {
		t = await createDsqlTestDb();
		repo = createDsqlActivationFunnelRepo(t.db);

		// signup dates
		await insertFamily(FAM.all, '2026-07-05T00:00:00.000Z');
		await insertFamily(FAM.late, '2026-07-05T00:00:00.000Z');
		await insertFamily(FAM.child, '2026-07-06T00:00:00.000Z');
		await insertFamily(FAM.signup, '2026-07-06T00:00:00.000Z');
		await insertFamily(FAM.old, '2026-06-01T00:00:00.000Z'); // cohort 外
		await insertFamily(FAM.cancelled, '2026-07-05T00:00:00.000Z');

		await insertChild(FAM.all, CHILD.all);
		await insertChild(FAM.late, CHILD.late);
		await insertChild(FAM.child, CHILD.child);
		await insertChild(FAM.cancelled, CHILD.cancelled);
		// old 家庭にも子供 (cohort 外なので集計に出ないことの確認用)
		await insertChild(FAM.old, '00000000-0000-4000-8000-00000000c005');

		// activities
		await insertActivity(FAM.all, CHILD.all, '2026-07-08T00:00:00.000Z', false); // +3 日 → retained
		await insertActivity(FAM.late, CHILD.late, '2026-07-20T00:00:00.000Z', false); // +15 日 → 非 retained
		await insertActivity(FAM.cancelled, CHILD.cancelled, '2026-07-06T00:00:00.000Z', true); // 取消
	});

	afterAll(async () => {
		await t.close();
	});

	it('4 段 funnel 件数を single-query で正しく導出する (cohort / 子供 / 非取消 / retention 窓)', async () => {
		const counts = await repo.getActivationFunnelCounts(SINCE, RETENTION_DAYS);

		// signup: all/late/child/signup/cancelled = 5 (old は cohort 外)
		expect(counts.signupCount).toBe(5);
		// first_child: all/late/child/cancelled = 4 (signup は子供なし)
		expect(counts.firstChildCount).toBe(4);
		// first_activity: all/late = 2 (child/signup は活動なし、cancelled は取消のみ)
		expect(counts.firstActivityCount).toBe(2);
		// retained_7d: all = 1 (late は窓外、cancelled は取消)
		expect(counts.retained7dCount).toBe(1);
	});

	it('cohort 外 (since より前の since2) を広げると old も signup に含まれる', async () => {
		const counts = await repo.getActivationFunnelCounts('2026-05-01T00:00:00.000Z', RETENTION_DAYS);
		// old も含めて 6 家庭。old は子供ありだが活動なし。
		expect(counts.signupCount).toBe(6);
		expect(counts.firstChildCount).toBe(5); // signup 家庭のみ子供なし
	});

	it('該当コホートが空 (未来 since) なら全段 0', async () => {
		const counts = await repo.getActivationFunnelCounts('2099-01-01T00:00:00.000Z', RETENTION_DAYS);
		expect(counts).toEqual({
			signupCount: 0,
			firstChildCount: 0,
			firstActivityCount: 0,
			retained7dCount: 0,
		});
	});
});
