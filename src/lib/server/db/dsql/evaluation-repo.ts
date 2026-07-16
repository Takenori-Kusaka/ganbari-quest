// src/lib/server/db/dsql/evaluation-repo.ts
// EPIC #3424 / M4-D PR6 (repo 層 child/activity 系) / 設計 SSOT: dsql-data-model.md §4 / §11.2 / §P9
//
// IEvaluationRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) と
//     TransactionRunner を呼び出し側 (将来の client factory / テスト) が渡す。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **evaluations.scores_json は text 据置** (M3 §4.2 [must]A / reset-plan 決定#1)。子表
//     evaluation_scores を作らず、カテゴリ別スコア集合 (count/points/status_increase) を
//     JSON 文字列で丸ごと保持する (列展開・子表化しない = 原初喪失の是正)。Evaluation.scoresJson
//     は SSOT 型で opaque string ゆえ repo は verbatim に read/write するのみ。
//   - **activity_logs の子供導出 (M2 §1.4 BCNF 是正)**: カテゴリ別集計は activity_logs →
//     child_activities への (family_id, child_id, activity_id) 3 軸 JOIN で category を導出する
//     (activity_logs は category 列を持たず「活動→R-CHILD_ACTIVITY 経由で子供/カテゴリ導出」。
//     JOIN の child_id 一致が「活動所有子供 = 本 log 行の子供」の app 層等価を honor)。
//   - **status_history append-only**: hasDecayRunToday は daily_decay 履歴の read のみ
//     (append-only 契約に read で触れる)。recorded_at は timestamptz ゆえ JST 暦日一致を
//     AT TIME ZONE 'Asia/Tokyo' で判定し、sqlite の 'YYYY-MM-DD' prefix LIKE と parity を取る。
//   - **自然キー entity の id** (§4): rest_days は surrogate 列を持たない (自然複合 PK
//     (family, child, date))。RestDay.id は複合キー合成 (`child:date`) を返す。RestDay.id の
//     service/route 消費は 0 件 (export は date/reason/createdAt を読む、grep 確認済) で、
//     entity shape 契約 (id: string) のみ維持する (status-repo の Status.id と同型判断)。

import { sql } from 'drizzle-orm';
import { asCategoryId, asChildId } from '$lib/domain/ids';
import type { IEvaluationRepo } from '../interfaces/evaluation-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { Child, Evaluation, RestDay } from '../types';
import { CHILD_COLUMNS, type ChildRow, toChild } from './child-repo';
import type { SqlExecutor } from './sql-executor';

interface EvaluationRow {
	child_id: string;
	eval_id: string;
	week_start: string;
	week_end: string;
	scores_json: string;
	bonus_points: number;
	created_at: string;
}

interface RestDayRow {
	child_id: string;
	date: string;
	reason: string;
	created_at: string;
}

const EVALUATION_COLUMNS = sql.raw(
	'child_id, eval_id, week_start, week_end, scores_json, bonus_points, created_at',
);
const REST_DAY_COLUMNS = sql.raw('child_id, date, reason, created_at');

/** row → Evaluation (scores_json は text 据置、verbatim string、§4.2)。 */
function toEvaluation(row: EvaluationRow): Evaluation {
	return {
		id: row.eval_id,
		childId: asChildId(row.child_id),
		weekStart: row.week_start,
		weekEnd: row.week_end,
		scoresJson: row.scores_json,
		bonusPoints: row.bonus_points,
		createdAt: row.created_at,
	};
}

/** row → RestDay (id は複合自然キー合成 `child:date`、§4 自然キー戦略 / 消費 0 件)。 */
function toRestDay(row: RestDayRow): RestDay {
	return {
		id: `${row.child_id}:${row.date}`,
		childId: asChildId(row.child_id),
		date: row.date,
		reason: row.reason,
		createdAt: row.created_at,
	};
}

/** DSQL 用 IEvaluationRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlEvaluationRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IEvaluationRepo {
	return {
		async countActivitiesByCategory(childId, weekStart, weekEnd, tenantId) {
			// activity_logs は category 列を持たない (M2 §1.4 BCNF)。child_activities へ
			// (family, child, activity) 3 軸 JOIN で category を導出する (子 log 行の child_id 一致で
			// 「活動所有子供 = 本 log 行の子供」を honor)。
			const result = await db.execute(sql`
				SELECT ca.category_id, count(*)::int AS c, coalesce(sum(al.points), 0)::int AS pts
				FROM activity_logs al
				INNER JOIN child_activities ca
					ON ca.family_id = al.family_id AND ca.child_id = al.child_id
					AND ca.activity_id = al.activity_id
				WHERE al.family_id = ${tenantId} AND al.child_id = ${childId}
					AND al.cancelled = false
					AND al.recorded_date >= ${weekStart} AND al.recorded_date <= ${weekEnd}
				GROUP BY ca.category_id
			`);
			return (result.rows as { category_id: string; c: number; pts: number }[]).map((r) => ({
				categoryId: asCategoryId(r.category_id),
				count: Number(r.c),
				totalPoints: Number(r.pts),
			}));
		},

		async insertEvaluation(input, tenantId) {
			// scores_json は verbatim text 据置 (子表化しない、§4.2)。
			// #3355: created_at は backup restore が渡した値を保全 (省略時は DB default = now)。
			const result = await db.execute(sql`
				INSERT INTO evaluations (family_id, child_id, week_start, week_end, scores_json, bonus_points, created_at)
				VALUES (${tenantId}, ${input.childId}, ${input.weekStart}, ${input.weekEnd},
					${input.scoresJson}, ${input.bonusPoints}, ${input.createdAt ?? sql`DEFAULT`})
				RETURNING ${EVALUATION_COLUMNS}
			`);
			return toEvaluation(result.rows[0] as unknown as EvaluationRow);
		},

		async findAllChildren(tenantId): Promise<Child[]> {
			// sqlite parity: archive 不問で全 child を返す (評価 cron は archived も走査対象)。
			// compute-on-read (§11.1) は toChild が担う。
			const result = await db.execute(sql`
				SELECT ${CHILD_COLUMNS} FROM children WHERE family_id = ${tenantId}
				ORDER BY created_at, child_id
			`);
			return (result.rows as unknown as ChildRow[]).map(toChild);
		},

		async findEvaluationsByChild(childId, limit, tenantId) {
			const result = await db.execute(sql`
				SELECT ${EVALUATION_COLUMNS} FROM evaluations
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY created_at DESC, eval_id DESC
				LIMIT ${limit}
			`);
			return (result.rows as unknown as EvaluationRow[]).map(toEvaluation);
		},

		async hasDecayRunToday(childId, today, tenantId) {
			// status_history は append-only (read で触れる)。recorded_at (timestamptz) の JST 暦日が
			// today ('YYYY-MM-DD') と一致する daily_decay 行の存在確認 (sqlite の prefix LIKE parity)。
			const result = await db.execute(sql`
				SELECT 1 FROM status_history
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND change_type = 'daily_decay'
					AND to_char(recorded_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') = ${today}
				LIMIT 1
			`);
			return result.rows.length > 0;
		},

		async findWeekEvaluation(childId, weekStart, tenantId) {
			const result = await db.execute(sql`
				SELECT eval_id FROM evaluations
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND week_start = ${weekStart}
				LIMIT 1
			`);
			const row = result.rows[0] as { eval_id: string } | undefined;
			return row ? { id: row.eval_id } : undefined;
		},

		async findLastActivityDateByCategory(childId, tenantId) {
			// activity_logs → child_activities 3 軸 JOIN で category 導出 (M2 §1.4、上と同型)。
			const result = await db.execute(sql`
				SELECT ca.category_id, max(al.recorded_date) AS last_date
				FROM activity_logs al
				INNER JOIN child_activities ca
					ON ca.family_id = al.family_id AND ca.child_id = al.child_id
					AND ca.activity_id = al.activity_id
				WHERE al.family_id = ${tenantId} AND al.child_id = ${childId} AND al.cancelled = false
				GROUP BY ca.category_id
			`);
			return (result.rows as { category_id: string; last_date: string }[]).map((r) => ({
				categoryId: asCategoryId(r.category_id),
				lastDate: r.last_date,
			}));
		},

		async insertRestDay(childId, date, reason, tenantId) {
			// 自然複合 PK (family, child, date) への冪等 insert (sqlite onConflictDoNothing parity)。
			const result = await db.execute(sql`
				INSERT INTO rest_days (family_id, child_id, date, reason)
				VALUES (${tenantId}, ${childId}, ${date}, ${reason})
				ON CONFLICT (family_id, child_id, date) DO NOTHING
				RETURNING ${REST_DAY_COLUMNS}
			`);
			const row = result.rows[0] as unknown as RestDayRow | undefined;
			return row ? toRestDay(row) : undefined;
		},

		async deleteRestDay(childId, date, tenantId) {
			await db.execute(sql`
				DELETE FROM rest_days
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND date = ${date}
			`);
		},

		async isRestDay(childId, date, tenantId) {
			const result = await db.execute(sql`
				SELECT 1 FROM rest_days
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND date = ${date}
				LIMIT 1
			`);
			return result.rows.length > 0;
		},

		async countRestDaysInMonth(childId, yearMonth, tenantId) {
			const result = await db.execute(sql`
				SELECT count(*)::int AS c FROM rest_days
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND date LIKE ${`${yearMonth}%`}
			`);
			return Number((result.rows[0] as { c: number }).c);
		},

		async findRestDays(childId, yearMonth, tenantId) {
			const result = await db.execute(sql`
				SELECT ${REST_DAY_COLUMNS} FROM rest_days
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND date LIKE ${`${yearMonth}%`}
				ORDER BY date
			`);
			return (result.rows as unknown as RestDayRow[]).map(toRestDay);
		},

		async findRestDaysByChild(childId, tenantId) {
			// #3329 backup: 月不問の全おやすみ日 (export 用)。
			const result = await db.execute(sql`
				SELECT ${REST_DAY_COLUMNS} FROM rest_days
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY date
			`);
			return (result.rows as unknown as RestDayRow[]).map(toRestDay);
		},

		async insertRestDayForRestore(input, tenantId) {
			// #3329 restore: created_at を保全して書き戻す (id は自然キーゆえ発番なし)。
			const result = await db.execute(sql`
				INSERT INTO rest_days (family_id, child_id, date, reason, created_at)
				VALUES (${tenantId}, ${input.childId}, ${input.date}, ${input.reason}, ${input.createdAt})
				ON CONFLICT (family_id, child_id, date) DO NOTHING
				RETURNING ${REST_DAY_COLUMNS}
			`);
			const row = result.rows[0] as unknown as RestDayRow | undefined;
			return row ? toRestDay(row) : undefined;
		},

		async deleteByTenantId(tenantId) {
			// rest_days + evaluations の 2 表削除を単一 txn で (fitness#7: work 内 await は
			// tx.execute 直呼びのみ)。sqlite parity (テナント内全行削除)。
			await runner.runInTransaction(async (tx) => {
				await tx.execute(sql`DELETE FROM rest_days WHERE family_id = ${tenantId}`);
				await tx.execute(sql`DELETE FROM evaluations WHERE family_id = ${tenantId}`);
			});
		},
	};
}
