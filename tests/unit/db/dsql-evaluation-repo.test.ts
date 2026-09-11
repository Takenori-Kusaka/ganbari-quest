// tests/unit/db/dsql-evaluation-repo.test.ts
// EPIC #3424 / M4-D PR6 (repo child/activity 系) / 設計 SSOT: dsql-data-model.md §4 / §11.2 / §P9
//
// IEvaluationRepo の DSQL backend テスト。実 schema (pushSchema 適用、dsql-test-db helper):
//   [E1] insertEvaluation → findEvaluationsByChild: scores_json text 据置 (count/points/
//        status_increase を丸ごと verbatim 保持、列展開・子表化しない、§4.2) + created_at 降順 + limit
//   [E2] countActivitiesByCategory: activity_logs→child_activities 3 軸 JOIN で category 導出
//        (M2 §1.4 BCNF) + week 窓 + cancelled 除外 + sum(points)
//   [E3] findLastActivityDateByCategory: category 別 max(recorded_date)
//   [E4] hasDecayRunToday: daily_decay 履歴の JST 暦日一致 (timestamptz、TZ 越え非該当も検証)
//   [E5] findWeekEvaluation: week_start 一致で存在確認
//   [E6] findAllChildren: archive 不問で全 child + compute-on-read (age 導出)
//   [E7] (#4691 で撤去) rest_days CRUD — おやすみ日機能廃止に伴い repo method ごと削除
//   [E8] §P9 tenant 分離: 他 family から evaluation 不可視
//   [E9] deleteByTenantId: evaluations (+ 空の rest_days 表) を tenant scope 削除 (他 tenant 無傷)

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asCategoryId, asChildId, type ChildId } from '../../../src/lib/domain/ids';
import { createDsqlEvaluationRepo } from '../../../src/lib/server/db/dsql/evaluation-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IEvaluationRepo } from '../../../src/lib/server/db/interfaces/evaluation-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000c2';
const CAT_EXERCISE = asCategoryId('1');
const CAT_STUDY = asCategoryId('2');

let t: DsqlTestDb;
let repo: IEvaluationRepo;

async function seedChild(
	familyId: string,
	nickname: string,
	birthDate = '2018-01-15',
): Promise<ChildId> {
	const res = await t.db.execute(sql`
		INSERT INTO children (family_id, nickname, birth_date, theme, ui_mode)
		VALUES (${familyId}, ${nickname}, ${birthDate}, 'blue', 'preschool')
		RETURNING child_id
	`);
	return asChildId((res.rows[0] as { child_id: string }).child_id);
}

/** child_activity を作り activity_id を返す (JOIN で category 導出する材料)。 */
async function seedActivity(
	familyId: string,
	childId: ChildId,
	categoryId = CAT_EXERCISE,
): Promise<string> {
	const res = await t.db.execute(sql`
		INSERT INTO child_activities (family_id, child_id, name, category_id, icon, base_points)
		VALUES (${familyId}, ${childId}, 'act', ${categoryId}, '🦷', 5)
		RETURNING activity_id
	`);
	return (res.rows[0] as { activity_id: string }).activity_id;
}

// biome-ignore lint/complexity/useMaxParams: test seed helper (activity_logs 列を素直に並べる)
async function seedLog(
	familyId: string,
	childId: ChildId,
	activityId: string,
	recordedDate: string,
	points: number,
	cancelled = false,
): Promise<void> {
	await t.db.execute(sql`
		INSERT INTO activity_logs (family_id, child_id, activity_id, points, recorded_date, cancelled)
		VALUES (${familyId}, ${childId}, ${activityId}, ${points}, ${recordedDate}, ${cancelled})
	`);
}

beforeAll(async () => {
	t = await createDsqlTestDb();
	const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
	repo = createDsqlEvaluationRepo(t.db, runner);
}, 60_000);
afterAll(async () => {
	await t.close();
});

describe('DSQL evaluation-repo (M4-D PR6、実 schema PGlite)', () => {
	it('[E1] insertEvaluation → findEvaluationsByChild: scores_json text 据置 + 降順 + limit', async () => {
		const child = await seedChild(FAMILY, 'E1');
		// count/points/status_increase を丸ごと保持する構造化 JSON (子表化せず verbatim text 据置)。
		const scores = JSON.stringify({
			'1': { count: 3, points: 15, statusIncrease: 6 },
			'2': { count: 1, points: 5, statusIncrease: 2 },
		});
		const created = await repo.insertEvaluation(
			{
				childId: child,
				weekStart: '2026-06-29',
				weekEnd: '2026-07-05',
				scoresJson: scores,
				bonusPoints: 10,
			},
			FAMILY,
		);
		expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(created.childId).toBe(child);
		expect(created.scoresJson).toBe(scores); // verbatim (data-loss なし)
		expect(created.bonusPoints).toBe(10);

		// 2 件目 (別週) → created_at 降順で最新が先頭
		await repo.insertEvaluation(
			{
				childId: child,
				weekStart: '2026-07-06',
				weekEnd: '2026-07-12',
				scoresJson: '{}',
				bonusPoints: 0,
			},
			FAMILY,
		);
		const all = await repo.findEvaluationsByChild(child, 10, FAMILY);
		expect(all).toHaveLength(2);
		expect(all[0]?.weekStart).toBe('2026-07-06');
		// round-trip: 保存した構造化 scores が壊れずパースできる
		expect(JSON.parse(all[1]?.scoresJson ?? '{}')['1'].statusIncrease).toBe(6);

		const limited = await repo.findEvaluationsByChild(child, 1, FAMILY);
		expect(limited).toHaveLength(1);
	});

	it('[E2] countActivitiesByCategory: JOIN で category 導出 + week 窓 + cancelled 除外 + sum', async () => {
		const child = await seedChild(FAMILY, 'E2');
		const actEx = await seedActivity(FAMILY, child, CAT_EXERCISE);
		const actSt = await seedActivity(FAMILY, child, CAT_STUDY);
		await seedLog(FAMILY, child, actEx, '2026-06-30', 5);
		await seedLog(FAMILY, child, actEx, '2026-07-01', 5);
		await seedLog(FAMILY, child, actSt, '2026-07-02', 8);
		await seedLog(FAMILY, child, actEx, '2026-07-02', 5, true); // cancelled → 除外
		await seedLog(FAMILY, child, actEx, '2026-07-20', 5); // 窓外 → 除外

		const counts = await repo.countActivitiesByCategory(child, '2026-06-29', '2026-07-05', FAMILY);
		const byCat = Object.fromEntries(counts.map((c) => [c.categoryId, c]));
		expect(byCat[CAT_EXERCISE]).toEqual({ categoryId: CAT_EXERCISE, count: 2, totalPoints: 10 });
		expect(byCat[CAT_STUDY]).toEqual({ categoryId: CAT_STUDY, count: 1, totalPoints: 8 });
	});

	it('[E3] findLastActivityDateByCategory: category 別 max(recorded_date)', async () => {
		const child = await seedChild(FAMILY, 'E3');
		const actEx = await seedActivity(FAMILY, child, CAT_EXERCISE);
		await seedLog(FAMILY, child, actEx, '2026-07-01', 5);
		await seedLog(FAMILY, child, actEx, '2026-07-04', 5);
		await seedLog(FAMILY, child, actEx, '2026-07-02', 5, true); // cancelled 除外

		const res = await repo.findLastActivityDateByCategory(child, FAMILY);
		expect(res).toContainEqual({ categoryId: CAT_EXERCISE, lastDate: '2026-07-04' });
	});

	it('[E4] hasDecayRunToday: daily_decay の JST 暦日一致 (TZ 越え非該当も検証)', async () => {
		const child = await seedChild(FAMILY, 'E4');
		// UTC 02:00 → JST 11:00 同日 (2026-07-06)
		await t.db.execute(sql`
			INSERT INTO status_history (family_id, child_id, category_id, value, change_amount, change_type, recorded_at)
			VALUES (${FAMILY}, ${child}, ${CAT_EXERCISE}, 10, -2, 'daily_decay', '2026-07-06T02:00:00Z')
		`);
		expect(await repo.hasDecayRunToday(child, '2026-07-06', FAMILY)).toBe(true);
		expect(await repo.hasDecayRunToday(child, '2026-07-05', FAMILY)).toBe(false);

		// change_type 違い (activity_record) は daily_decay として数えない
		const child2 = await seedChild(FAMILY, 'E4b');
		await t.db.execute(sql`
			INSERT INTO status_history (family_id, child_id, category_id, value, change_amount, change_type, recorded_at)
			VALUES (${FAMILY}, ${child2}, ${CAT_EXERCISE}, 10, 5, 'activity_record', '2026-07-06T02:00:00Z')
		`);
		expect(await repo.hasDecayRunToday(child2, '2026-07-06', FAMILY)).toBe(false);

		// TZ 越え: UTC 20:00 (2026-07-06) → JST 05:00 (2026-07-07)。today=2026-07-06 は非該当
		const child3 = await seedChild(FAMILY, 'E4c');
		await t.db.execute(sql`
			INSERT INTO status_history (family_id, child_id, category_id, value, change_amount, change_type, recorded_at)
			VALUES (${FAMILY}, ${child3}, ${CAT_EXERCISE}, 10, -2, 'daily_decay', '2026-07-06T20:00:00Z')
		`);
		expect(await repo.hasDecayRunToday(child3, '2026-07-06', FAMILY)).toBe(false);
		expect(await repo.hasDecayRunToday(child3, '2026-07-07', FAMILY)).toBe(true);
	});

	it('[E5] findWeekEvaluation: week_start 一致で存在確認', async () => {
		const child = await seedChild(FAMILY, 'E5');
		await repo.insertEvaluation(
			{
				childId: child,
				weekStart: '2026-05-04',
				weekEnd: '2026-05-10',
				scoresJson: '{}',
				bonusPoints: 0,
			},
			FAMILY,
		);
		const found = await repo.findWeekEvaluation(child, '2026-05-04', FAMILY);
		expect(found?.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(await repo.findWeekEvaluation(child, '2026-05-11', FAMILY)).toBeUndefined();
	});

	it('[E5b] #3782: 同 (child, weekStart) 再 insert は week UNIQUE (evaluations_week_uq) で冪等 — 二重行を作らず既存行を返す', async () => {
		const child = await seedChild(FAMILY, 'E5b');
		const first = await repo.insertEvaluation(
			{
				childId: child,
				weekStart: '2026-08-03',
				weekEnd: '2026-08-09',
				scoresJson: '{"a":1}',
				bonusPoints: 10,
			},
			FAMILY,
		);
		// 同一 (family, child, weekStart) を再 insert (並行ロード / restore backstop 相当)
		const second = await repo.insertEvaluation(
			{
				childId: child,
				weekStart: '2026-08-03',
				weekEnd: '2026-08-09',
				scoresJson: '{"a":999}', // 内容が違っても新規行は作らない
				bonusPoints: 999,
			},
			FAMILY,
		);
		// ON CONFLICT DO NOTHING → 既存行 (first) がそのまま返る (throw しない)
		expect(second.id).toBe(first.id);
		expect(second.scoresJson).toBe('{"a":1}'); // 既存行が保全される (上書きしない)
		// 物理的に 1 行のみ (二重計上なし)
		const all = await repo.findEvaluationsByChild(child, 100, FAMILY);
		expect(all.filter((e) => e.weekStart === '2026-08-03')).toHaveLength(1);
	});

	it('[E6] findAllChildren: archive 不問 + compute-on-read (age 導出)', async () => {
		const fam = '00000000-0000-4000-8000-0000000000c6';
		const active = await seedChild(fam, 'E6-active', '2018-01-15');
		const archived = await seedChild(fam, 'E6-archived');
		await t.db.execute(
			sql`UPDATE children SET is_archived = true WHERE family_id = ${fam} AND child_id = ${archived}`,
		);
		const children = await repo.findAllChildren(fam);
		expect(children.map((c) => c.id).sort()).toEqual([active, archived].sort());
		const activeRow = children.find((c) => c.id === active);
		expect(activeRow?.age).toBeGreaterThan(0); // birth_date から compute-on-read
	});

	it('[E8] §P9 tenant 分離: 他 family から evaluation 不可視', async () => {
		const child = await seedChild(FAMILY, 'E8');
		await repo.insertEvaluation(
			{
				childId: child,
				weekStart: '2026-03-02',
				weekEnd: '2026-03-08',
				scoresJson: '{}',
				bonusPoints: 0,
			},
			FAMILY,
		);
		// 他 family tenant からは 0 件
		expect(await repo.findEvaluationsByChild(child, 10, OTHER_FAMILY)).toEqual([]);
		expect(await repo.findWeekEvaluation(child, '2026-03-02', OTHER_FAMILY)).toBeUndefined();
	});

	it('[E9] deleteByTenantId: evaluations (+ 空の rest_days 表) を tenant scope 削除 (他 tenant 無傷)', async () => {
		const famA = '00000000-0000-4000-8000-0000000000c9';
		const childA = await seedChild(famA, 'E9a');
		const childB = await seedChild(OTHER_FAMILY, 'E9b');
		await repo.insertEvaluation(
			{
				childId: childA,
				weekStart: '2026-01-05',
				weekEnd: '2026-01-11',
				scoresJson: '{}',
				bonusPoints: 0,
			},
			famA,
		);
		await repo.insertEvaluation(
			{
				childId: childB,
				weekStart: '2026-01-05',
				weekEnd: '2026-01-11',
				scoresJson: '{}',
				bonusPoints: 0,
			},
			OTHER_FAMILY,
		);

		await repo.deleteByTenantId(famA);
		expect(await repo.findEvaluationsByChild(childA, 10, famA)).toEqual([]);
		// 他 tenant は無傷
		expect(await repo.findEvaluationsByChild(childB, 10, OTHER_FAMILY)).toHaveLength(1);
	});
});
