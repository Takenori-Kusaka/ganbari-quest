// src/lib/server/db/evaluation-repo.ts
// 週次評価関連のリポジトリ層

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { asCategoryId, asChildId, type ChildId } from '$lib/domain/ids';
import { db } from '../client';
import {
	activityLogs,
	childActivities,
	children,
	evaluations,
	restDays,
	statusHistory,
} from '../schema';
import type {
	CategoryActivityCount,
	CategoryLastDate,
	Child,
	Evaluation,
	InsertEvaluationInput,
} from '../types';

type EvaluationRow = typeof evaluations.$inferSelect;

const toEvaluation = (r: EvaluationRow): Evaluation => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
});

/** 指定期間のカテゴリ別活動回数を集計 */
export async function countActivitiesByCategory(
	childId: ChildId,
	weekStart: string,
	weekEnd: string,
	_tenantId: string,
): Promise<CategoryActivityCount[]> {
	// #2362 PR-3 Phase 7b-2c: schema FK は child_activities に切替済 (Phase 7b-2a)
	return db
		.select({
			categoryId: childActivities.categoryId,
			count: sql<number>`count(*)`,
			totalPoints: sql<number>`sum(${activityLogs.points})`,
		})
		.from(activityLogs)
		.innerJoin(childActivities, eq(activityLogs.activityId, childActivities.id))
		.where(
			and(
				eq(activityLogs.childId, Number(childId)),
				eq(activityLogs.cancelled, 0),
				gte(activityLogs.recordedDate, weekStart),
				lte(activityLogs.recordedDate, weekEnd),
			),
		)
		.groupBy(childActivities.categoryId)
		.all()
		.map((r) => ({ ...r, categoryId: asCategoryId(r.categoryId) }));
}

/** 評価結果を保存 */
export async function insertEvaluation(
	input: InsertEvaluationInput,
	_tenantId: string,
): Promise<Evaluation> {
	// #3782: (child_id, week_start) unique index (idx_evaluations_child_week) との衝突は「1週1評価」の
	// 冪等 no-op として扱う (throw しない)。status page の並行ロード (findWeekEvaluation guard を race)
	// や restore backstop で二重行を作らず、既存行を返す。
	const inserted = db
		.insert(evaluations)
		.values({ ...input, childId: Number(input.childId) })
		.onConflictDoNothing()
		.returning()
		.get();
	if (inserted) return toEvaluation(inserted);
	const existing = db
		.select()
		.from(evaluations)
		.where(
			and(
				eq(evaluations.childId, Number(input.childId)),
				eq(evaluations.weekStart, input.weekStart),
			),
		)
		.get();
	if (existing) return toEvaluation(existing);
	// 到達しない: conflict した = 同 (child, week) 行が必ず存在する。型安全 (Evaluation 非 null) のため明示。
	throw new Error(
		`insertEvaluation: conflict without existing row (child=${input.childId}, week=${input.weekStart})`,
	);
}

/** 全子供を取得 */
export async function findAllChildren(_tenantId: string): Promise<Child[]> {
	return db
		.select()
		.from(children)
		.all()
		.map((r) => ({ ...r, id: asChildId(r.id) }));
}

/** 子供の評価履歴を取得 */
export async function findEvaluationsByChild(
	childId: ChildId,
	limit: number,
	_tenantId: string,
): Promise<Evaluation[]> {
	return db
		.select()
		.from(evaluations)
		.where(eq(evaluations.childId, Number(childId)))
		.orderBy(desc(evaluations.createdAt))
		.limit(limit)
		.all()
		.map(toEvaluation);
}

/** 指定日にdaily_decayが既に実行されたか確認 */
export async function hasDecayRunToday(
	childId: ChildId,
	today: string,
	_tenantId: string,
): Promise<boolean> {
	const row = db
		.select({ id: statusHistory.id })
		.from(statusHistory)
		.where(
			and(
				eq(statusHistory.childId, Number(childId)),
				eq(statusHistory.changeType, 'daily_decay'),
				// #4722: recorded_at は UTC ISO で保存されるため、JST 暦日 (today) と比べるには
				// +9h してから日付にする。旧実装の prefix LIKE は UTC 暦日との比較で、
				// JST 0〜9 時に「今日まだ減衰していない」と誤判定していた (dsql 側は JST 判定済)。
				sql`date(${statusHistory.recordedAt}, '+9 hours') = ${today}`,
			),
		)
		.get();
	return !!row;
}

/** 指定週の評価が存在するか確認 */
export async function findWeekEvaluation(
	childId: ChildId,
	weekStart: string,
	_tenantId: string,
): Promise<{ id: string } | undefined> {
	const row = db
		.select({ id: evaluations.id })
		.from(evaluations)
		.where(and(eq(evaluations.childId, Number(childId)), eq(evaluations.weekStart, weekStart)))
		.get();
	return row ? { id: String(row.id) } : undefined;
}

/** 子供の最終活動日をカテゴリ別に取得 */
export async function findLastActivityDateByCategory(
	childId: ChildId,
	_tenantId: string,
): Promise<CategoryLastDate[]> {
	// #2362 PR-3 Phase 7b-2c: schema FK は child_activities に切替済
	return db
		.select({
			categoryId: childActivities.categoryId,
			lastDate: sql<string>`max(${activityLogs.recordedDate})`,
		})
		.from(activityLogs)
		.innerJoin(childActivities, eq(activityLogs.activityId, childActivities.id))
		.where(and(eq(activityLogs.childId, Number(childId)), eq(activityLogs.cancelled, 0)))
		.groupBy(childActivities.categoryId)
		.all()
		.map((r) => ({ ...r, categoryId: asCategoryId(r.categoryId) }));
}

/** テナントの全評価データを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(restDays).run();
	db.delete(evaluations).run();
}
