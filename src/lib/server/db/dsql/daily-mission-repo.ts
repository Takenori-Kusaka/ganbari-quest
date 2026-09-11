// src/lib/server/db/dsql/daily-mission-repo.ts
// EPIC #3424 / PR-R6 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §8 / §11.2 / §P9
//
// IDailyMissionRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。全メソッドが単文のため
//     TransactionRunner は不要 (txn を要する完了+bonus 経路は daily-mission-complete.ts が正)。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **daily_missions は自然複合 PK (family, child, mission_date, activity_id、§11.2 凍結)**:
//     surrogate id 列を持たないため、entity の `id` は複合キーの合成文字列
//     (`child:date:activity`) を返す (status-repo の §4 自然キー戦略と同判断。
//     DailyMissionWithActivity.id の消費は UI 表示 key のみで grep 確認済)。
//   - **complete 系の委譲 (fitness#10)**: 「完了 flip + 全完了 bonus 付与」の単一 txn は
//     daily-mission-complete.ts (completeMissionAndMaybeGrantBonus) が実装済の正であり、
//     本 repo は重複実装しない。interface の markMissionCompleted は void 契約 (bonus 引数 /
//     結果を持たない) のため完全委譲は契約不一致 — 本メソッドは flag flip 単体のみを担い、
//     fitness#10 と同じ **conditional UPDATE (completed = false → true)** を serialization
//     point として使う (再実行は 0 行 no-op = completed_at を上書きしない)。service cutover 時、
//     bonus を伴う完了経路は completeMissionAndMaybeGrantBonus を呼ぶこと (count-then-insert の
//     TOCTOU 二重付与を再導入しない)。
//   - **insertDailyMission は PK への ON CONFLICT DO NOTHING** (#2565 parity: 並行 generate の
//     重複 INSERT を constraint violation にせず同一 mission set に収束)。
//   - findMissionBonusRecord は point_ledger type='daily_mission' filter (sqlite parity。
//     daily-mission-complete.ts の 'mission_bonus' は cutover 後経路で別 type)。
//   - entity 境界: completed は number (0/1) 契約 — boolean 列を読み出し時に変換
//     (sqlite backend と同一 shape)。

import { sql } from 'drizzle-orm';
import { type ActivityId, asActivityId, asCategoryId, type ChildId } from '$lib/domain/ids';
import type { IDailyMissionRepo } from '../interfaces/daily-mission-repo.interface';
import { ACTIVITY_COLUMNS, type ChildActivityRow, toChildActivity } from './child-activity-repo';
import { CHILD_COLUMNS, type ChildRow, toChild } from './child-repo';
import type { SqlExecutor } from './sql-executor';

interface MissionJoinRow {
	child_id: string;
	mission_date: string;
	activity_id: string;
	completed: boolean;
	activity_name: string;
	activity_icon: string;
	category_id: string;
}

/** 自然複合 PK の合成 id (`child:date:activity`、surrogate 列なし §11.2)。 */
function missionId(childId: string, date: string, activityId: string): string {
	return `${childId}:${date}:${activityId}`;
}

/** DSQL 用 IDailyMissionRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlDailyMissionRepo(db: SqlExecutor): IDailyMissionRepo {
	return {
		async findTodayMissions(childId, date, tenantId) {
			// child_activities join は (family, child, activity) の 3 軸 = PK 完全一致 (§P9)。
			const result = await db.execute(sql`
				SELECT dm.child_id, dm.mission_date, dm.activity_id, dm.completed,
					ca.name AS activity_name, ca.icon AS activity_icon, ca.category_id
				FROM daily_missions dm
				JOIN child_activities ca
					ON ca.family_id = dm.family_id AND ca.child_id = dm.child_id
					AND ca.activity_id = dm.activity_id
				WHERE dm.family_id = ${tenantId} AND dm.child_id = ${childId}
					AND dm.mission_date = ${date}
				ORDER BY dm.activity_id
			`);
			return (result.rows as unknown as MissionJoinRow[]).map((r) => ({
				id: missionId(r.child_id, r.mission_date, r.activity_id),
				activityId: asActivityId(r.activity_id),
				completed: r.completed ? 1 : 0,
				activityName: r.activity_name,
				activityIcon: r.activity_icon,
				categoryId: asCategoryId(r.category_id),
			}));
		},

		async findMissionBonusRecord(childId, description, tenantId) {
			// sqlite parity: type='daily_mission' + description 一致の既付与 lookup。
			const result = await db.execute(sql`
				SELECT amount FROM point_ledger
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND type = 'daily_mission' AND description = ${description}
				LIMIT 1
			`);
			const row = result.rows[0] as { amount: number } | undefined;
			return row ? { amount: Number(row.amount) } : undefined;
		},

		async findMissionByActivity(childId, date, activityId, tenantId) {
			const result = await db.execute(sql`
				SELECT child_id, mission_date, activity_id, completed FROM daily_missions
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND mission_date = ${date} AND activity_id = ${activityId}
			`);
			const row = result.rows[0] as unknown as MissionJoinRow | undefined;
			if (!row) return undefined;
			return {
				id: missionId(row.child_id, row.mission_date, row.activity_id),
				completed: row.completed ? 1 : 0,
			};
		},

		async markMissionCompleted(childId, date, activityId, tenantId) {
			// #2845 B1: 複合キー完全一致 (不在 / 不一致は silent no-op)。completed = false 条件は
			// fitness#10 の serialization point と同型 (再実行は 0 行 = completed_at 不変)。
			// bonus を伴う完了経路は daily-mission-complete.ts に委譲すること (header 注記)。
			await db.execute(sql`
				UPDATE daily_missions SET completed = true, completed_at = now()
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND mission_date = ${date} AND activity_id = ${activityId}
					AND completed = false
			`);
		},

		async markMissionUncompleted(childId, date, activityId, tenantId) {
			// #4686: とりけし時の対称巻き戻し。complete 側と同じ複合キー完全一致 (不在は silent no-op)。
			await db.execute(sql`
				UPDATE daily_missions SET completed = false, completed_at = NULL
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND mission_date = ${date} AND activity_id = ${activityId}
					AND completed = true
			`);
		},

		async findAllMissionStatuses(childId, date, tenantId) {
			const result = await db.execute(sql`
				SELECT completed FROM daily_missions
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND mission_date = ${date}
				ORDER BY activity_id
			`);
			return (result.rows as { completed: boolean }[]).map((r) => ({
				completed: r.completed ? 1 : 0,
			}));
		},

		async findChildForMission(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${CHILD_COLUMNS} FROM children
				WHERE family_id = ${tenantId} AND child_id = ${childId}
			`);
			const row = result.rows[0] as unknown as ChildRow | undefined;
			return row ? toChild(row) : undefined;
		},

		async findVisibleActivities(tenantId) {
			// sqlite parity: is_visible のみ filter (archived は filter しない)。DSQL は
			// multi-tenant のため §P9 family 述語を追加 (callsite の child filter は service 側)。
			const result = await db.execute(sql`
				SELECT ${ACTIVITY_COLUMNS} FROM child_activities
				WHERE family_id = ${tenantId} AND is_visible = true
				ORDER BY child_id, sort_order, created_at, activity_id
			`);
			return (result.rows as unknown as ChildActivityRow[]).map(toChildActivity);
		},

		async findPreviousDayMissionIds(childId, date, tenantId): Promise<ActivityId[]> {
			const result = await db.execute(sql`
				SELECT activity_id FROM daily_missions
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND mission_date = ${date}
			`);
			return (result.rows as { activity_id: string }[]).map((r) => asActivityId(r.activity_id));
		},

		async findRecentActivityIds(childId, sinceDate, tenantId): Promise<ActivityId[]> {
			const result = await db.execute(sql`
				SELECT DISTINCT activity_id FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND recorded_date >= ${sinceDate} AND cancelled = false
			`);
			return (result.rows as { activity_id: string }[]).map((r) => asActivityId(r.activity_id));
		},

		async findAllRecordedActivityIds(childId, tenantId): Promise<ActivityId[]> {
			const result = await db.execute(sql`
				SELECT DISTINCT activity_id FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND cancelled = false
			`);
			return (result.rows as { activity_id: string }[]).map((r) => asActivityId(r.activity_id));
		},

		async insertDailyMission(childId: ChildId, date, activityId, tenantId) {
			// #2565 parity: 並行 generate の重複 INSERT は PK ON CONFLICT で silent skip し
			// 同一 mission set に収束させる (constraint violation の 500 を出さない)。
			await db.execute(sql`
				INSERT INTO daily_missions (family_id, child_id, mission_date, activity_id)
				VALUES (${tenantId}, ${childId}, ${date}, ${activityId})
				ON CONFLICT (family_id, child_id, mission_date, activity_id) DO NOTHING
			`);
		},

		async deleteByTenantId(tenantId) {
			// sqlite (シングルテナント全行削除) と違い family 述語で tenant 限定 (§P9)。
			await db.execute(sql`DELETE FROM daily_missions WHERE family_id = ${tenantId}`);
		},
	};
}
