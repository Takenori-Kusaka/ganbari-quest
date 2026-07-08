// tests/unit/db/dsql-report-daily-summary-repo.test.ts
// EPIC #3424 / cutover 配線 / 設計 SSOT: dsql-data-model.md §7 (read-model 廃止 → compute-on-read)
//
// DSQL IReportDailySummaryRepo (基表 activity_logs × child_activities からの compute-on-read)
// のテスト。実 schema (pushSchema 適用、dsql-test-db helper)。観点:
//
//   [S1] 日次集計 shape: activityCount / totalPoints (points 合計) / categoryBreakdown
//        (category_id 別件数 JSON) / 固定 field (checklistCompletion '{}' / level 1 /
//        newAchievements 0) / id = `${childId}:${date}` / date 昇順
//   [S2] 母集合 = findTodayLogsWithCategory 意味論: cancelled 除外 + orphan log
//        (child_activities に無い activity_id) 除外。cancelled のみの日は row を生成しない
//   [S3] streakDays: gaps-and-islands で「その日で終わる連続活動日数」。range 先頭日でも
//        range 外の過去履歴を含めて連続判定される (calculateStreak parity)
//   [S4] findByTenantAndDateRange: 複数 child 集計 + §P9 tenant 分離
//   [S5] no-op 契約: 表が無いため upsert / deleteOlderThan / deleteByTenantId はエラーに
//        ならず、upsert しても compute-on-read の結果は変わらない (保存されない)

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ActivityId, asActivityId, type ChildId } from '../../../src/lib/domain/ids';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { createDsqlReportDailySummaryRepo } from '../../../src/lib/server/db/dsql/report-daily-summary-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import type { IReportDailySummaryRepo } from '../../../src/lib/server/db/interfaces/report-daily-summary-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000d1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000d2';

describe('DSQL report-daily-summary-repo (§7 compute-on-read、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let childRepo: IChildRepo;
	let repo: IReportDailySummaryRepo;

	const newChild = async (nickname: string, family = FAMILY): Promise<ChildId> => {
		const c = await childRepo.insertChild({ nickname, age: 8, birthDate: '2018-01-15' }, family);
		return c.id;
	};

	const seedActivity = async (
		childId: ChildId,
		opts: { name?: string; categoryId?: string; family?: string } = {},
	): Promise<ActivityId> => {
		const result = await t.db.execute(sql`
			INSERT INTO child_activities (family_id, child_id, name, category_id, icon)
			VALUES (${opts.family ?? FAMILY}, ${String(childId)}, ${opts.name ?? 'かつどう'},
				${opts.categoryId ?? 'exercise'}, ${'🏃'})
			RETURNING activity_id
		`);
		return asActivityId((result.rows[0] as { activity_id: string }).activity_id);
	};

	const seedLog = async (
		childId: ChildId,
		activityId: ActivityId,
		opts: { date: string; points?: number; cancelled?: boolean; family?: string },
	): Promise<void> => {
		await t.db.execute(sql`
			INSERT INTO activity_logs
				(family_id, child_id, activity_id, points, recorded_date, recorded_at, cancelled)
			VALUES (${opts.family ?? FAMILY}, ${String(childId)}, ${String(activityId)},
				${opts.points ?? 10}, ${opts.date}, ${`${opts.date}T09:00:00Z`}, ${opts.cancelled ?? false})
		`);
	};

	beforeAll(async () => {
		t = await createDsqlTestDb();
		const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		childRepo = createDsqlChildRepo(t.db, runner);
		repo = createDsqlReportDailySummaryRepo(t.db);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	it('[S1] 日次集計 shape: count / points / categoryBreakdown / 固定 field / id 合成 / 昇順', async () => {
		const childId = await newChild('集計一郎');
		const ex = await seedActivity(childId, { name: 'うんどう', categoryId: 'exercise' });
		const st = await seedActivity(childId, { name: 'べんきょう', categoryId: 'study' });
		await seedLog(childId, ex, { date: '2026-06-02', points: 5 });
		await seedLog(childId, ex, { date: '2026-06-02', points: 7 });
		await seedLog(childId, st, { date: '2026-06-02', points: 3 });
		await seedLog(childId, st, { date: '2026-06-01', points: 4 });
		await seedLog(childId, ex, { date: '2026-06-30', points: 9 }); // range 外

		const rows = await repo.findByChildAndDateRange(childId, '2026-06-01', '2026-06-10', FAMILY);
		expect(rows.map((r) => r.date)).toEqual(['2026-06-01', '2026-06-02']); // date 昇順 + range 絞り

		const day2 = rows[1];
		if (!day2) throw new Error('unreachable');
		expect(day2.id).toBe(`${String(childId)}:2026-06-02`);
		expect(day2.tenantId).toBe(FAMILY);
		expect(day2.childId).toBe(childId);
		expect(day2.activityCount).toBe(3);
		expect(day2.totalPoints).toBe(15); // 5 + 7 + 3 (当日 points 合計)
		expect(JSON.parse(day2.categoryBreakdown)).toEqual({ exercise: 2, study: 1 });
		// 固定 field (repo ヘッダーコメントの導出可否どおり)
		expect(day2.checklistCompletion).toBe('{}');
		expect(day2.level).toBe(1);
		expect(day2.newAchievements).toBe(0);
		expect(typeof day2.createdAt).toBe('string');

		const day1 = rows[0];
		expect(day1?.activityCount).toBe(1);
		expect(day1?.totalPoints).toBe(4);
		expect(JSON.parse(day1?.categoryBreakdown ?? '{}')).toEqual({ study: 1 });
	});

	it('[S2] cancelled 除外 + orphan log 除外 (findTodayLogsWithCategory 意味論)', async () => {
		const childId = await newChild('除外二郎');
		const act = await seedActivity(childId, { name: 'たいそう' });
		await seedLog(childId, act, { date: '2026-07-01', points: 10 });
		await seedLog(childId, act, { date: '2026-07-01', points: 99, cancelled: true });
		// cancelled のみの日は row を生成しない
		await seedLog(childId, act, { date: '2026-07-02', points: 50, cancelled: true });
		// orphan log (child_activities に存在しない activity_id) は JOIN で落ちる
		await t.db.execute(sql`
			INSERT INTO activity_logs
				(family_id, child_id, activity_id, points, recorded_date, recorded_at)
			VALUES (${FAMILY}, ${String(childId)}, ${'00000000-0000-4000-8000-00000000dead'},
				${77}, ${'2026-07-03'}, ${'2026-07-03T09:00:00Z'})
		`);

		const rows = await repo.findByChildAndDateRange(childId, '2026-07-01', '2026-07-31', FAMILY);
		expect(rows.map((r) => r.date)).toEqual(['2026-07-01']);
		expect(rows[0]?.activityCount).toBe(1); // cancelled は数えない
		expect(rows[0]?.totalPoints).toBe(10);
	});

	it('[S3] streakDays: 連続日 islands + range 外の過去履歴も連続判定に入る', async () => {
		const childId = await newChild('連続三郎');
		const act = await seedActivity(childId, { name: 'まいにち' });
		await seedLog(childId, act, { date: '2026-08-01' });
		await seedLog(childId, act, { date: '2026-08-02' });
		await seedLog(childId, act, { date: '2026-08-03' });
		// gap (08-04 なし)
		await seedLog(childId, act, { date: '2026-08-05' });

		const all = await repo.findByChildAndDateRange(childId, '2026-08-01', '2026-08-31', FAMILY);
		expect(all.map((r) => [r.date, r.streakDays])).toEqual([
			['2026-08-01', 1],
			['2026-08-02', 2],
			['2026-08-03', 3],
			['2026-08-05', 1], // gap で島がリセット
		]);

		// range を 08-02 開始に絞っても、08-01 の履歴を含めた連続日数 (=2) が返る
		const tail = await repo.findByChildAndDateRange(childId, '2026-08-02', '2026-08-03', FAMILY);
		expect(tail.map((r) => [r.date, r.streakDays])).toEqual([
			['2026-08-02', 2],
			['2026-08-03', 3],
		]);
	});

	it('[S4] findByTenantAndDateRange: 複数 child 集計 + §P9 tenant 分離', async () => {
		const family = '00000000-0000-4000-8000-0000000000d3';
		const c1 = await newChild('家族四郎', family);
		const c2 = await newChild('家族五郎', family);
		const a1 = await seedActivity(c1, { family });
		const a2 = await seedActivity(c2, { family, categoryId: 'study' });
		await seedLog(c1, a1, { date: '2026-09-01', points: 5, family });
		await seedLog(c2, a2, { date: '2026-09-01', points: 8, family });
		await seedLog(c2, a2, { date: '2026-09-02', points: 2, family });

		const rows = await repo.findByTenantAndDateRange(family, '2026-09-01', '2026-09-30');
		expect(rows).toHaveLength(3);
		const byChild = new Map<string, string[]>();
		for (const r of rows) {
			byChild.set(String(r.childId), [...(byChild.get(String(r.childId)) ?? []), r.date]);
		}
		expect(byChild.get(String(c1))).toEqual(['2026-09-01']);
		expect(byChild.get(String(c2))).toEqual(['2026-09-01', '2026-09-02']);
		expect(rows.every((r) => r.tenantId === family)).toBe(true);

		// tenant 分離: 他 family からは不可視 (by-tenant / by-child 両方)
		expect(await repo.findByTenantAndDateRange(OTHER_FAMILY, '2026-09-01', '2026-09-30')).toEqual(
			[],
		);
		expect(
			await repo.findByChildAndDateRange(c1, '2026-09-01', '2026-09-30', OTHER_FAMILY),
		).toEqual([]);
	});

	it('[S5] no-op 契約: 表が無くてもエラーにならず、upsert は保存されない', async () => {
		const childId = await newChild('契約六郎');
		const act = await seedActivity(childId);
		await seedLog(childId, act, { date: '2026-10-01', points: 3 });

		// upsert は no-op (throw しない)。書いた値は compute-on-read の結果に影響しない
		await expect(
			repo.upsert({
				tenantId: FAMILY,
				childId,
				date: '2026-10-01',
				activityCount: 999,
				categoryBreakdown: '{"fake":999}',
				checklistCompletion: '{"fake":1}',
				level: 99,
				totalPoints: 9999,
				streakDays: 99,
				newAchievements: 99,
			}),
		).resolves.toBeUndefined();

		const rows = await repo.findByChildAndDateRange(childId, '2026-10-01', '2026-10-31', FAMILY);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.activityCount).toBe(1); // 基表からの導出値のまま (upsert 値は現れない)
		expect(rows[0]?.totalPoints).toBe(3);

		await expect(repo.deleteOlderThan(FAMILY, '2099-12-31')).resolves.toBe(0);
		await expect(repo.deleteByTenantId(FAMILY)).resolves.toBeUndefined();
		// delete 系 no-op 後も基表は無傷 = compute-on-read の結果が変わらない
		const after = await repo.findByChildAndDateRange(childId, '2026-10-01', '2026-10-31', FAMILY);
		expect(after).toHaveLength(1);
	});
});
