// tests/unit/db/dsql-activity-log-repo.test.ts
// EPIC #3424 / PR-R5 / 設計 SSOT: dsql-data-model.md §11.2 / §3.5.5 / §5(P7) / §P9
//
// DSQL IActivityRepo (activities + activity_logs) 実装のテスト。実 schema (pushSchema 適用、
// dsql-test-db helper)。観点:
//
// ── Activities (Activity shape adapter parity) ──
//   [A1] findActivities: ChildActivity → Activity shape adapter parity (差分 field null 埋め、
//        0/1 契約、sort_order 順、archived 既定除外、includeHidden / categoryId filter)
//   [A2] findActivityById / updateActivity (部分更新 + 空 input no-op) / setActivityVisibility /
//        deleteActivity round-trip、不在は undefined
//   [A3] insertActivity: tenant 先頭 child bind (sqlite facade parity)、child 不在 tenant は throw
//   [A4] countMainQuestActivities / archiveActivities / restoreArchivedActivities
//   [A5] hasActivityLogs / getActivityLogCounts (cancelled 除外) / deleteDailyMissionsByActivity
//
// ── Activity Logs ──
//   [L1] insertActivityLog → findDailyLog / findActivityLogById / countTodayActiveRecords /
//        markActivityLogCancelled (cancelled 0/1 契約、cancel 後 findDailyLog 不可視)
//   [L2] findActivityLogs: 日付 range (from/to) filter + cancelled 除外 + recorded_at 降順 +
//        summary shape (activityName/activityIcon/categoryId) — JOIN 1 クエリ
//   [L3] findStreakLogs (降順) / findTodayRecordedActivityIds / getTodayActivityCountsByChild
//
// ── Aggregation (SQL 集計 1 クエリ、app 側 loop 集計にしない §3.5.5) ──
//   [G1] findDistinctRecordedDates (重複除去 昇順) / countActiveActivityLogs /
//        getCategoryCountsByDate / countDistinctCategories / findTodayLogsWithCategory /
//        countActiveActivityLogsByCategory
//   [G2] getComboPointsGranted (description prefix) / countPointLedgerEntriesByType /
//        countPointLedgerEntriesByTypeAndDate (recorded_date 冪等 lookup、§11.2 H21)
//   [M1] findMustActivitiesWithToday: 単一 LEFT JOIN 集計の正値 (logged/total/loggedToday)
//
// ── 不変条件 ──
//   [P1] insertPointLedger: §5 P7 — ledger INSERT + children.total_point 同一 txn 共更新
//        (fitness#14 drift 0)、child 不在は throw + rollback
//   [R1] deleteActivityLogsBeforeDate: strict less-than + 削除件数
//   [T1] §P9 tenant 分離: 他 family から activities / logs / counts 不可視・write 不能

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type ActivityId,
	asActivityId,
	asCategoryId,
	asChildId,
	type ChildId,
} from '../../../src/lib/domain/ids';
import { createDsqlActivityRepo } from '../../../src/lib/server/db/dsql/activity-repo';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { findTotalPointDrift } from '../../../src/lib/server/db/dsql/derived-drift';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IActivityRepo } from '../../../src/lib/server/db/interfaces/activity-repo.interface';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000c2';
const EMPTY_FAMILY = '00000000-0000-4000-8000-0000000000c3';

describe('DSQL activity-repo (PR-R5、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let childRepo: IChildRepo;
	let repo: IActivityRepo;

	const newChild = async (nickname: string, family = FAMILY): Promise<ChildId> => {
		const c = await childRepo.insertChild({ nickname, age: 8, birthDate: '2018-01-15' }, family);
		return c.id;
	};

	/** child_activities を直接 seed する (per-child bind をテストが制御するため)。 */
	const seedActivity = async (
		childId: ChildId,
		opts: {
			name?: string;
			categoryId?: string;
			icon?: string;
			basePoints?: number;
			priority?: 'must' | 'optional';
			isMainQuest?: boolean;
			isVisible?: boolean;
			isArchived?: boolean;
			sortOrder?: number;
			family?: string;
		} = {},
	): Promise<ActivityId> => {
		const result = await t.db.execute(sql`
			INSERT INTO child_activities
				(family_id, child_id, name, category_id, icon, base_points, priority, is_main_quest,
				 is_visible, is_archived, sort_order)
			VALUES (${opts.family ?? FAMILY}, ${String(childId)}, ${opts.name ?? 'かつどう'},
				${opts.categoryId ?? 'exercise'}, ${opts.icon ?? '🏃'}, ${opts.basePoints ?? 5},
				${opts.priority ?? 'optional'}, ${opts.isMainQuest ?? false}, ${opts.isVisible ?? true},
				${opts.isArchived ?? false}, ${opts.sortOrder ?? 0})
			RETURNING activity_id
		`);
		return asActivityId((result.rows[0] as { activity_id: string }).activity_id);
	};

	/** activity_logs を直接 seed する (recorded_at を決定的に制御するため)。 */
	const seedLog = async (
		childId: ChildId,
		activityId: ActivityId,
		opts: {
			date: string;
			points?: number;
			cancelled?: boolean;
			recordedAt?: string;
			family?: string;
		},
	): Promise<string> => {
		const result = await t.db.execute(sql`
			INSERT INTO activity_logs
				(family_id, child_id, activity_id, points, recorded_date, recorded_at, cancelled)
			VALUES (${opts.family ?? FAMILY}, ${String(childId)}, ${String(activityId)},
				${opts.points ?? 10}, ${opts.date}, ${opts.recordedAt ?? `${opts.date}T09:00:00Z`},
				${opts.cancelled ?? false})
			RETURNING log_id
		`);
		return (result.rows[0] as { log_id: string }).log_id;
	};

	beforeAll(async () => {
		t = await createDsqlTestDb();
		const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		childRepo = createDsqlChildRepo(t.db, runner);
		repo = createDsqlActivityRepo(t.db, runner);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// ─────────────────── Activities (Activity shape adapter) ───────────────────

	it('[A1] findActivities: Activity shape adapter parity + filter + sort', async () => {
		const childId = await newChild('形状一郎');
		await seedActivity(childId, { name: 'あとから', sortOrder: 2, categoryId: 'study' });
		await seedActivity(childId, { name: 'さいしょ', sortOrder: 1 });
		await seedActivity(childId, { name: 'かくれ', sortOrder: 3, isVisible: false });
		await seedActivity(childId, { name: 'そうこ', sortOrder: 4, isArchived: true });

		const visible = await repo.findActivities(FAMILY);
		expect(visible.map((a) => a.name)).toEqual(['さいしょ', 'あとから']); // sort_order 順
		const first = visible[0];
		if (!first) throw new Error('unreachable');
		// Activity shape adapter parity: 差分 field は null 埋め (sqlite _toActivityShape と同一)
		expect(first.ageMin).toBe(null);
		expect(first.ageMax).toBe(null);
		expect(first.gradeLevel).toBe(null);
		expect(first.subcategory).toBe(null);
		expect(first.description).toBe(null);
		expect(first.isVisible).toBe(1); // boolean → 0/1 契約
		expect(first.isMainQuest).toBe(0);
		expect(first.isArchived).toBe(0);
		expect(first.categoryId).toBe(asCategoryId('exercise'));
		expect(first.basePoints).toBe(5);
		expect(typeof first.id).toBe('string');
		expect(typeof first.createdAt).toBe('string');

		// includeHidden で非表示も返る (archived は依然除外)
		const withHidden = await repo.findActivities(FAMILY, { includeHidden: true });
		expect(withHidden.map((a) => a.name)).toEqual(['さいしょ', 'あとから', 'かくれ']);
		// categoryId filter
		const study = await repo.findActivities(FAMILY, { categoryId: asCategoryId('study') });
		expect(study.map((a) => a.name)).toEqual(['あとから']);
	});

	it('[A2] findActivityById / updateActivity / setActivityVisibility / deleteActivity', async () => {
		const childId = await newChild('更新二郎');
		const id = await seedActivity(childId, { name: 'へんしゅう', basePoints: 5 });

		const found = await repo.findActivityById(id, FAMILY);
		expect(found?.name).toBe('へんしゅう');

		// 部分更新: 指定 field のみ変わる
		const updated = await repo.updateActivity(
			id,
			{ name: 'かいてい', basePoints: 8, priority: 'must' },
			FAMILY,
		);
		expect(updated?.name).toBe('かいてい');
		expect(updated?.basePoints).toBe(8);
		expect(updated?.priority).toBe('must');
		expect(updated?.icon).toBe('🏃'); // 未指定 field は不変

		// 空 input は no-op で既存行を返す (sqlite parity)
		const noop = await repo.updateActivity(id, {}, FAMILY);
		expect(noop?.name).toBe('かいてい');

		const hidden = await repo.setActivityVisibility(id, false, FAMILY);
		expect(hidden?.isVisible).toBe(0);

		const deleted = await repo.deleteActivity(id, FAMILY);
		expect(deleted?.name).toBe('かいてい');
		expect(await repo.findActivityById(id, FAMILY)).toBeUndefined();

		// 不在 id は undefined (throw しない)
		const ghost = asActivityId('00000000-0000-4000-8000-00000000dead');
		expect(await repo.updateActivity(ghost, { name: 'x' }, FAMILY)).toBeUndefined();
		expect(await repo.setActivityVisibility(ghost, true, FAMILY)).toBeUndefined();
		expect(await repo.deleteActivity(ghost, FAMILY)).toBeUndefined();
	});

	it('[A3] insertActivity: tenant 先頭 child bind + child 不在 tenant は throw', async () => {
		// 専用 family (child 1 人) で bind 先を決定的にする
		const soloFamily = '00000000-0000-4000-8000-0000000000c4';
		const soloChild = await newChild('単独三郎', soloFamily);
		const created = await repo.insertActivity(
			{
				name: 'しんき',
				categoryId: asCategoryId('life'),
				icon: '🧹',
				basePoints: 7,
				ageMin: null,
				ageMax: null,
				priority: 'must',
				isMainQuest: 1,
			},
			soloFamily,
		);
		expect(created.name).toBe('しんき');
		expect(created.basePoints).toBe(7);
		expect(created.priority).toBe('must');
		expect(created.isMainQuest).toBe(1);
		// per-child instance として先頭 child に bind されている
		const bound = await t.db.execute(sql`
			SELECT child_id FROM child_activities
			WHERE family_id = ${soloFamily} AND activity_id = ${String(created.id)}
		`);
		expect((bound.rows[0] as { child_id: string }).child_id).toBe(String(soloChild));

		// child 不在 tenant は throw (sqlite parity)
		await expect(
			repo.insertActivity(
				{
					name: 'x',
					categoryId: asCategoryId('life'),
					icon: 'x',
					basePoints: 1,
					ageMin: null,
					ageMax: null,
				},
				EMPTY_FAMILY,
			),
		).rejects.toThrow();
	});

	it('[A3b] insertActivity facade 契約 (#3596 ③): 同秒 created_at でも child_id tiebreak で決定的に代表 child へ bind', async () => {
		// facade 契約再評価 (#3596 ③): child selector を持たない family-level 呼出は代表 child
		// (最古 created_at) に bind する。同秒 created_at 家庭でも `ORDER BY created_at, child_id`
		// の child_id (uuid) 第 2 sort key で一意・決定的に選ばれる (「同秒 tiebreak 非決定」懸念の解消)。
		const tieFamily = '00000000-0000-4000-8000-0000000000ca';
		const sameInstant = '2020-02-02T02:02:02.000Z';
		// 2 child を **同一 created_at** で seed (child_id uuid は自動採番、非決定に見える条件を作る)。
		const seedTieChild = async (nickname: string): Promise<string> => {
			const r = await t.db.execute(sql`
				INSERT INTO children (family_id, nickname, birth_date, theme, ui_mode, created_at)
				VALUES (${tieFamily}, ${nickname}, '2018-01-15', 'blue', 'preschool', ${sameInstant})
				RETURNING child_id
			`);
			return (r.rows[0] as { child_id: string }).child_id;
		};
		const idA = await seedTieChild('同秒A');
		const idB = await seedTieChild('同秒B');
		// created_at が同一なら child_id 昇順で先頭 = lexicographically-min の uuid が代表 child。
		const expectedRep = [idA, idB].sort()[0];

		const boundChildOf = async (name: string): Promise<string> => {
			const created = await repo.insertActivity(
				{
					name,
					categoryId: asCategoryId('life'),
					icon: '🧩',
					basePoints: 3,
					ageMin: null,
					ageMax: null,
				},
				tieFamily,
			);
			const row = await t.db.execute(sql`
				SELECT child_id FROM child_activities
				WHERE family_id = ${tieFamily} AND activity_id = ${String(created.id)}
			`);
			return (row.rows[0] as { child_id: string }).child_id;
		};

		// 2 回連続 insert しても同一の代表 child に bind される (決定的 = 冪等な bind 先)。
		expect(await boundChildOf('たい1')).toBe(expectedRep);
		expect(await boundChildOf('たい2')).toBe(expectedRep);
	});

	it('[A4] countMainQuestActivities / archive / restore', async () => {
		const family = '00000000-0000-4000-8000-0000000000c5';
		const childId = await newChild('メイン四郎', family);
		const a1 = await seedActivity(childId, { name: 'めいん', isMainQuest: true, family });
		await seedActivity(childId, { name: 'ふつう', family });
		await seedActivity(childId, {
			name: 'めいんかくれ',
			isMainQuest: true,
			isVisible: false,
			family,
		});

		expect(await repo.countMainQuestActivities(family)).toBe(1); // visible & not archived のみ

		await repo.archiveActivities([a1], 'trial_expired', family);
		expect(await repo.countMainQuestActivities(family)).toBe(0);
		const archived = await repo.findActivities(family, { includeHidden: true });
		expect(archived.some((a) => a.name === 'めいん')).toBe(false); // archived は既定除外

		await repo.restoreArchivedActivities('trial_expired', family);
		expect(await repo.countMainQuestActivities(family)).toBe(1);
		const restored = await repo.findActivityById(a1, family);
		expect(restored?.isArchived).toBe(0);
		expect(restored?.archivedReason).toBe(null);

		// 空 ids は no-op
		await expect(repo.archiveActivities([], 'trial_expired', family)).resolves.toBeUndefined();
	});

	it('[A5] hasActivityLogs / getActivityLogCounts / deleteDailyMissionsByActivity', async () => {
		const childId = await newChild('記録五郎');
		const a1 = await seedActivity(childId, { name: 'ろぐあり' });
		const a2 = await seedActivity(childId, { name: 'ろぐなし' });
		await seedLog(childId, a1, { date: '2026-06-01' });
		await seedLog(childId, a1, { date: '2026-06-02' });
		await seedLog(childId, a1, { date: '2026-06-03', cancelled: true });

		expect(await repo.hasActivityLogs(a1, FAMILY)).toBe(true);
		expect(await repo.hasActivityLogs(a2, FAMILY)).toBe(false);

		const counts = await repo.getActivityLogCounts(FAMILY);
		expect(counts[String(a1)]).toBe(2); // cancelled 除外
		expect(counts[String(a2)]).toBeUndefined();

		// daily_missions: 対象 activity の行だけ消える
		await t.db.execute(sql`
			INSERT INTO daily_missions (family_id, child_id, mission_date, activity_id)
			VALUES
				(${FAMILY}, ${String(childId)}, '2026-06-01', ${String(a1)}),
				(${FAMILY}, ${String(childId)}, '2026-06-01', ${String(a2)})
		`);
		await repo.deleteDailyMissionsByActivity(a1, FAMILY);
		const missions = await t.db.execute(sql`
			SELECT activity_id FROM daily_missions
			WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}
		`);
		expect(missions.rows).toHaveLength(1);
		expect((missions.rows[0] as { activity_id: string }).activity_id).toBe(String(a2));
	});

	// ─────────────────── Activity Logs ───────────────────

	it('[L1] insertActivityLog → findDailyLog / findActivityLogById / cancel round-trip', async () => {
		const childId = await newChild('日誌六郎');
		const activityId = await seedActivity(childId, { name: 'にっし' });

		const log = await repo.insertActivityLog(
			{
				childId,
				activityId,
				points: 12,
				streakDays: 3,
				streakBonus: 2,
				recordedDate: '2026-06-10',
				recordedAt: '2026-06-10T08:30:00Z',
			},
			FAMILY,
		);
		expect(log.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(log.childId).toBe(childId);
		expect(log.activityId).toBe(activityId);
		expect(log.points).toBe(12);
		expect(log.streakDays).toBe(3);
		expect(log.streakBonus).toBe(2);
		expect(log.recordedDate).toBe('2026-06-10');
		expect(log.cancelled).toBe(0); // boolean → 0/1 契約

		const daily = await repo.findDailyLog(childId, activityId, '2026-06-10', FAMILY);
		expect(daily?.id).toBe(log.id);
		expect(await repo.findDailyLog(childId, activityId, '2026-06-11', FAMILY)).toBeUndefined();

		const byId = await repo.findActivityLogById(log.id, FAMILY);
		expect(byId?.points).toBe(12);

		expect(await repo.countTodayActiveRecords(childId, activityId, '2026-06-10', FAMILY)).toBe(1);

		await repo.markActivityLogCancelled(log.id, FAMILY);
		const cancelled = await repo.findActivityLogById(log.id, FAMILY);
		expect(cancelled?.cancelled).toBe(1);
		// cancel 後は findDailyLog / countTodayActiveRecords から不可視 (dailyLimit 再記録可能)
		expect(await repo.findDailyLog(childId, activityId, '2026-06-10', FAMILY)).toBeUndefined();
		expect(await repo.countTodayActiveRecords(childId, activityId, '2026-06-10', FAMILY)).toBe(0);
	});

	it('[L2] findActivityLogs: 日付 range + cancelled 除外 + 降順 + summary shape', async () => {
		const childId = await newChild('履歴七郎');
		const act = await seedActivity(childId, { name: 'れきし', icon: '📖', categoryId: 'study' });
		await seedLog(childId, act, { date: '2026-06-01', points: 1 });
		await seedLog(childId, act, { date: '2026-06-05', points: 2 });
		await seedLog(childId, act, { date: '2026-06-09', points: 3 });
		await seedLog(childId, act, { date: '2026-06-05', points: 99, cancelled: true });

		const all = await repo.findActivityLogs(childId, FAMILY);
		expect(all.map((l) => l.points)).toEqual([3, 2, 1]); // recorded_at 降順、cancelled 除外
		const head = all[0];
		if (!head) throw new Error('unreachable');
		expect(head.activityName).toBe('れきし'); // JOIN summary shape
		expect(head.activityIcon).toBe('📖');
		expect(head.categoryId).toBe(asCategoryId('study'));
		expect(typeof head.id).toBe('string');

		const ranged = await repo.findActivityLogs(childId, FAMILY, {
			from: '2026-06-02',
			to: '2026-06-08',
		});
		expect(ranged.map((l) => l.points)).toEqual([2]);
		const fromOnly = await repo.findActivityLogs(childId, FAMILY, { from: '2026-06-05' });
		expect(fromOnly.map((l) => l.points)).toEqual([3, 2]);
		const toOnly = await repo.findActivityLogs(childId, FAMILY, { to: '2026-06-05' });
		expect(toOnly.map((l) => l.points)).toEqual([2, 1]);
	});

	it('[L3] findStreakLogs / findTodayRecordedActivityIds / getTodayActivityCountsByChild', async () => {
		const childId = await newChild('連続八郎');
		const a1 = await seedActivity(childId, { name: 'まいにち' });
		const a2 = await seedActivity(childId, { name: 'ときどき' });
		await seedLog(childId, a1, { date: '2026-06-01' });
		await seedLog(childId, a1, { date: '2026-06-02' });
		await seedLog(childId, a1, { date: '2026-06-03', cancelled: true });
		await seedLog(childId, a1, {
			date: '2026-06-04',
			recordedAt: '2026-06-04T08:00:00Z',
		});
		await seedLog(childId, a1, {
			date: '2026-06-04',
			recordedAt: '2026-06-04T10:00:00Z',
		});
		await seedLog(childId, a2, { date: '2026-06-04' });

		const streak = await repo.findStreakLogs(childId, a1, FAMILY);
		// 降順 + cancelled 除外 (2026-06-04 は 2 records)
		expect(streak.map((s) => s.recordedDate)).toEqual([
			'2026-06-04',
			'2026-06-04',
			'2026-06-02',
			'2026-06-01',
		]);

		const todayIds = await repo.findTodayRecordedActivityIds(childId, '2026-06-04', FAMILY);
		expect(new Set(todayIds)).toEqual(new Set([a1, a2]));

		const counts = await repo.getTodayActivityCountsByChild(childId, '2026-06-04', FAMILY);
		const countMap = new Map(counts.map((c) => [c.activityId, c.count]));
		expect(countMap.get(a1)).toBe(2);
		expect(countMap.get(a2)).toBe(1);
	});

	// ─────────────────── Aggregation (SQL 集計 1 クエリ) ───────────────────

	it('[G1] 集計群: distinct dates / counts / category 集計の正値', async () => {
		const childId = await newChild('集計九郎');
		const ex = await seedActivity(childId, { name: 'うんどう', categoryId: 'exercise' });
		const st = await seedActivity(childId, { name: 'べんきょう', categoryId: 'study' });
		await seedLog(childId, ex, { date: '2026-06-01', recordedAt: '2026-06-01T08:00:00Z' });
		await seedLog(childId, ex, { date: '2026-06-01', recordedAt: '2026-06-01T09:00:00Z' });
		await seedLog(childId, st, { date: '2026-06-01', recordedAt: '2026-06-01T10:00:00Z' });
		await seedLog(childId, st, { date: '2026-06-02' });
		await seedLog(childId, ex, { date: '2026-06-03', cancelled: true });

		const dates = await repo.findDistinctRecordedDates(childId, FAMILY);
		expect(dates.map((d) => d.recordedDate)).toEqual(['2026-06-01', '2026-06-02']); // 重複除去 昇順

		expect(await repo.countActiveActivityLogs(childId, FAMILY)).toBe(4);

		const byDate = await repo.getCategoryCountsByDate(childId, FAMILY);
		const byDateMap = new Map(byDate.map((r) => [r.recordedDate, r.categoryCount]));
		expect(byDateMap.get('2026-06-01')).toBe(2); // exercise + study
		expect(byDateMap.get('2026-06-02')).toBe(1);

		expect(await repo.countDistinctCategories(childId, FAMILY)).toBe(2);

		const todayLogs = await repo.findTodayLogsWithCategory(childId, '2026-06-01', FAMILY);
		expect(todayLogs).toHaveLength(3);
		expect(todayLogs.filter((l) => l.categoryId === asCategoryId('exercise'))).toHaveLength(2);

		expect(
			await repo.countActiveActivityLogsByCategory(childId, asCategoryId('exercise'), FAMILY),
		).toBe(2); // cancelled 除外
		expect(
			await repo.countActiveActivityLogsByCategory(childId, asCategoryId('study'), FAMILY),
		).toBe(2);
	});

	it('[G2] point_ledger 集計: combo prefix / type count / type+date count', async () => {
		const childId = await newChild('台帳十郎');
		const id = String(childId);
		await t.db.execute(sql`
			INSERT INTO point_ledger (family_id, child_id, amount, type, description, recorded_date)
			VALUES
				(${FAMILY}, ${id}, 5, 'combo_bonus', 'コンボ2026-06-01:a', '2026-06-01'),
				(${FAMILY}, ${id}, 3, 'combo_bonus', 'コンボ2026-06-01:b', '2026-06-01'),
				(${FAMILY}, ${id}, 7, 'combo_bonus', 'コンボ2026-06-02:a', '2026-06-02'),
				(${FAMILY}, ${id}, 9, 'focus_bonus', 'コンボ2026-06-01:c', '2026-06-01'),
				(${FAMILY}, ${id}, 4, 'focus_bonus', 'しゅうちゅう', '2026-06-02')
		`);

		expect(await repo.getComboPointsGranted(childId, 'コンボ2026-06-01', FAMILY)).toBe(8); // 5+3
		expect(await repo.getComboPointsGranted(childId, 'コンボ2099', FAMILY)).toBe(0); // 該当なし

		expect(await repo.countPointLedgerEntriesByType(childId, 'combo_bonus', FAMILY)).toBe(3);
		expect(await repo.countPointLedgerEntriesByType(childId, 'none', FAMILY)).toBe(0);

		// recorded_date 冪等 lookup (§11.2 H21)
		expect(
			await repo.countPointLedgerEntriesByTypeAndDate(childId, 'combo_bonus', '2026-06-01', FAMILY),
		).toBe(2);
		expect(
			await repo.countPointLedgerEntriesByTypeAndDate(childId, 'focus_bonus', '2026-06-02', FAMILY),
		).toBe(1);
	});

	it('[M1] findMustActivitiesWithToday: 単一集計の正値', async () => {
		const childId = await newChild('約束十一');
		const m1 = await seedActivity(childId, { name: 'はみがき', priority: 'must', sortOrder: 1 });
		const m2 = await seedActivity(childId, { name: 'しゅくだい', priority: 'must', sortOrder: 2 });
		await seedActivity(childId, { name: 'ますとかくれ', priority: 'must', isVisible: false });
		await seedActivity(childId, {
			name: 'ますとそうこ',
			priority: 'must',
			isArchived: true,
		});
		await seedActivity(childId, { name: 'にんい', priority: 'optional' });
		// m1 は今日 2 回記録 (loggedToday は 1 に正規化)、m2 は cancelled のみ (未達扱い)
		await seedLog(childId, m1, { date: '2026-06-15', recordedAt: '2026-06-15T08:00:00Z' });
		await seedLog(childId, m1, { date: '2026-06-15', recordedAt: '2026-06-15T09:00:00Z' });
		await seedLog(childId, m2, { date: '2026-06-15', cancelled: true });
		await seedLog(childId, m2, { date: '2026-06-14' }); // 別日は今日に数えない

		const result = await repo.findMustActivitiesWithToday(childId, '2026-06-15', FAMILY);
		expect(result.total).toBe(2); // visible & active な must のみ
		expect(result.logged).toBe(1);
		expect(result.activities.map((a) => a.name)).toEqual(['はみがき', 'しゅくだい']); // sort_order 順
		expect(result.activities[0]?.loggedToday).toBe(1);
		expect(result.activities[1]?.loggedToday).toBe(0);

		// must 0 件 child は空集計
		const noMust = await newChild('約束十二');
		expect(await repo.findMustActivitiesWithToday(noMust, '2026-06-15', FAMILY)).toEqual({
			logged: 0,
			total: 0,
			activities: [],
		});
	});

	// ─────────────────── 不変条件 ───────────────────

	it('[P1] insertPointLedger: §5 P7 total_point 同一 txn 共更新 + child 不在 rollback', async () => {
		const childId = await newChild('台帳十三');
		await repo.insertPointLedger(
			{ childId, amount: 15, type: 'activity', description: 'きろく', referenceId: 'log-1' },
			FAMILY,
		);
		await repo.insertPointLedger(
			{ childId, amount: -4, type: 'activity_cancel', description: 'とりけし' },
			FAMILY,
		);
		const balance = await t.db.execute(sql`
			SELECT total_point FROM children
			WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}
		`);
		expect(Number((balance.rows[0] as { total_point: number }).total_point)).toBe(11);
		// fitness#14: total_point == SUM(point_ledger.amount)
		const drift = await findTotalPointDrift(t.db);
		expect(drift.filter((d) => String(d.childId) === String(childId))).toEqual([]);

		// child 不在は throw + ledger 未挿入 (片肺書込 rollback、point-repo と同判断)
		const ghost = asChildId('00000000-0000-4000-8000-00000000dead');
		await expect(
			repo.insertPointLedger({ childId: ghost, amount: 5, type: 'x', description: 'x' }, FAMILY),
		).rejects.toThrow();
		const ghostRows = await t.db.execute(sql`
			SELECT count(*) AS c FROM point_ledger
			WHERE family_id = ${FAMILY} AND child_id = ${String(ghost)}
		`);
		expect(Number((ghostRows.rows[0] as { c: unknown }).c)).toBe(0);
	});

	it('[R1] deleteActivityLogsBeforeDate: strict less-than + 削除件数', async () => {
		const childId = await newChild('保持十四');
		const act = await seedActivity(childId, { name: 'ほじ' });
		await seedLog(childId, act, { date: '2026-01-01' });
		await seedLog(childId, act, { date: '2026-02-01' });
		await seedLog(childId, act, { date: '2026-03-01' });

		const deleted = await repo.deleteActivityLogsBeforeDate(childId, '2026-02-01', FAMILY);
		expect(deleted).toBe(1); // cutoff 当日は残す (strict less than)
		const remaining = await repo.findDistinctRecordedDates(childId, FAMILY);
		expect(remaining.map((d) => d.recordedDate)).toEqual(['2026-02-01', '2026-03-01']);

		expect(await repo.deleteActivityLogsBeforeDate(childId, '2020-01-01', FAMILY)).toBe(0);
	});

	it('[T1] §P9 tenant 分離: 他 family から不可視・write 不能', async () => {
		const childId = await newChild('分離十五');
		const act = await seedActivity(childId, { name: 'じぶんの' });
		const logId = await seedLog(childId, act, { date: '2026-06-20' });

		// read 系: 他 family からは全て不可視
		expect(
			(await repo.findActivities(OTHER_FAMILY)).some((a) => String(a.id) === String(act)),
		).toBe(false);
		expect(await repo.findActivityById(act, OTHER_FAMILY)).toBeUndefined();
		expect(await repo.findDailyLog(childId, act, '2026-06-20', OTHER_FAMILY)).toBeUndefined();
		expect(await repo.findActivityLogById(logId, OTHER_FAMILY)).toBeUndefined();
		expect(await repo.findActivityLogs(childId, OTHER_FAMILY)).toEqual([]);
		expect(await repo.hasActivityLogs(act, OTHER_FAMILY)).toBe(false);
		expect((await repo.getActivityLogCounts(OTHER_FAMILY))[String(act)]).toBeUndefined();
		expect(await repo.countActiveActivityLogs(childId, OTHER_FAMILY)).toBe(0);
		expect(await repo.findChildById(childId, OTHER_FAMILY)).toBeUndefined();

		// write 系: 他 family からの update / delete / cancel は no-op (行が消えない)
		expect(await repo.updateActivity(act, { name: '侵入' }, OTHER_FAMILY)).toBeUndefined();
		expect(await repo.deleteActivity(act, OTHER_FAMILY)).toBeUndefined();
		await repo.markActivityLogCancelled(logId, OTHER_FAMILY);
		const survived = await repo.findActivityLogById(logId, FAMILY);
		expect(survived?.cancelled).toBe(0); // 越境 cancel は効かない
		expect((await repo.findActivityById(act, FAMILY))?.name).toBe('じぶんの');
		expect(await repo.deleteActivityLogsBeforeDate(childId, '2099-01-01', OTHER_FAMILY)).toBe(0);
	});

	it('findChildById: child-repo 委譲 (compute-on-read parity)', async () => {
		const childId = await newChild('存在十六');
		const found = await repo.findChildById(childId, FAMILY);
		expect(found?.nickname).toBe('存在十六');
		expect(found?.age).toBe(8);
		expect(found?.isArchived).toBe(0);
	});
});
