// src/lib/server/db/dsql/status-repo.ts
// EPIC #3424 / PR-R4 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §5 / §11.2 / §P9
//
// IStatusRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。
//   - **§P9 tenant 述語**: market_benchmarks (グローバル master、tenant 非依存 §11.2) を除く
//     全メソッドが family_id = tenantId を WHERE に含む。
//   - statuses は自然複合 PK (family, child, category) で ON CONFLICT upsert 1 文
//     (§11.2 unique(child,category) 昇格。sqlite の read→update/insert 2 発を単文化)。
//     total_xp の負値 0 clamp は sqlite backend と同一契約。
//   - statuses / market_benchmarks は surrogate id 列を持たない (§4 自然キー戦略) ため、
//     entity の `id` は複合キーの合成文字列 (`child:category` / `age:category`) を返す。
//     Status.id / MarketBenchmark.id の service/route 消費は 0 件 (grep 確認済) で、
//     entity shape 契約 (id: string) のみ維持する。
//   - hot path 書込 (recordActivity の statuses/status_history/XP 加算) は
//     record-activity-core.ts §8 が担う — 本 repo は読取と管理系 upsert の contract 実装。
//   - findStatusValueAtDate / findRecentStatusHistory の recorded_at は timestamptz。
//     'YYYY-MM-DD' / ISO いずれの beforeDate も ::timestamptz cast で辞書順比較と同義。

import { sql } from 'drizzle-orm';
import { asCategoryId, asChildId } from '$lib/domain/ids';
import type { IStatusRepo } from '../interfaces/status-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { MarketBenchmark, Status, StatusHistoryEntry } from '../types';
import { CHILD_COLUMNS, type ChildRow, toChild } from './child-repo';
import { isUuidFormat } from './pg-uuid';
import type { SqlExecutor } from './sql-executor';

interface StatusRow {
	child_id: string;
	category_id: string;
	total_xp: number;
	level: number;
	peak_xp: number;
	updated_at: string;
}

interface HistoryRow {
	hist_id: string;
	child_id: string;
	category_id: string;
	value: number;
	change_amount: number;
	change_type: string;
	recorded_at: string;
}

interface BenchmarkRow {
	age: number;
	category_id: string;
	mean: number;
	std_dev: number;
	source: string | null;
	updated_at: string;
}

const STATUS_COLUMNS = sql.raw('child_id, category_id, total_xp, level, peak_xp, updated_at');
const HISTORY_COLUMNS = sql.raw(
	'hist_id, child_id, category_id, value, change_amount, change_type, recorded_at',
);
const BENCHMARK_COLUMNS = sql.raw('age, category_id, mean, std_dev, source, updated_at');

/** row → Status (id は複合キー合成、§4 自然キー戦略)。 */
function toStatus(row: StatusRow): Status {
	return {
		id: `${row.child_id}:${row.category_id}`,
		childId: asChildId(row.child_id),
		categoryId: asCategoryId(row.category_id),
		totalXp: row.total_xp,
		level: row.level,
		peakXp: row.peak_xp,
		updatedAt: row.updated_at,
	};
}

function toHistory(row: HistoryRow): StatusHistoryEntry {
	return {
		id: row.hist_id,
		childId: asChildId(row.child_id),
		categoryId: asCategoryId(row.category_id),
		value: Number(row.value),
		changeAmount: Number(row.change_amount),
		changeType: row.change_type,
		recordedAt: row.recorded_at,
	};
}

/** row → MarketBenchmark (id は複合キー合成、§4 自然キー戦略)。 */
function toBenchmark(row: BenchmarkRow): MarketBenchmark {
	return {
		id: `${row.age}:${row.category_id}`,
		age: row.age,
		categoryId: asCategoryId(row.category_id),
		mean: Number(row.mean),
		stdDev: Number(row.std_dev),
		source: row.source,
		updatedAt: row.updated_at,
	};
}

/** DSQL 用 IStatusRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlStatusRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IStatusRepo {
	return {
		async findStatuses(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${STATUS_COLUMNS} FROM statuses
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY category_id
			`);
			return (result.rows as unknown as StatusRow[]).map(toStatus);
		},

		async findStatus(childId, categoryId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${STATUS_COLUMNS} FROM statuses
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND category_id = ${categoryId}
			`);
			const row = result.rows[0] as unknown as StatusRow | undefined;
			return row ? toStatus(row) : undefined;
		},

		// biome-ignore lint/complexity/useMaxParams: interface 契約 (sqlite backend と同一、別 Issue でオブジェクト引数化予定)
		async upsertStatus(childId, categoryId, totalXp, level, peakXp, tenantId) {
			// 自然複合 PK への ON CONFLICT upsert 1 文 (§11.2)。負 XP は 0 clamp (sqlite parity)。
			const clampedXp = Math.max(0, totalXp);
			const result = await db.execute(sql`
				INSERT INTO statuses (family_id, child_id, category_id, total_xp, level, peak_xp, updated_at)
				VALUES (${tenantId}, ${childId}, ${categoryId}, ${clampedXp}, ${level}, ${peakXp}, now())
				ON CONFLICT (family_id, child_id, category_id)
				DO UPDATE SET total_xp = ${clampedXp}, level = ${level}, peak_xp = ${peakXp}, updated_at = now()
				RETURNING ${STATUS_COLUMNS}
			`);
			return toStatus(result.rows[0] as unknown as StatusRow);
		},

		async insertStatusHistory(input, tenantId) {
			const result = await db.execute(sql`
				INSERT INTO status_history (family_id, child_id, category_id, value, change_amount, change_type)
				VALUES (${tenantId}, ${input.childId}, ${input.categoryId}, ${input.value},
					${input.changeAmount}, ${input.changeType})
				RETURNING ${HISTORY_COLUMNS}
			`);
			return toHistory(result.rows[0] as unknown as HistoryRow);
		},

		async findRecentStatusHistory(childId, categoryId, tenantId, limit = 7) {
			const result = await db.execute(sql`
				SELECT ${HISTORY_COLUMNS} FROM status_history
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND category_id = ${categoryId}
				ORDER BY recorded_at DESC, hist_id DESC
				LIMIT ${limit}
			`);
			return (result.rows as unknown as HistoryRow[]).map(toHistory);
		},

		async findStatusValueAtDate(childId, categoryId, beforeDate, tenantId) {
			const result = await db.execute(sql`
				SELECT value FROM status_history
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND category_id = ${categoryId}
					AND recorded_at < ${beforeDate}::timestamptz
				ORDER BY recorded_at DESC, hist_id DESC
				LIMIT 1
			`);
			const row = result.rows[0] as { value: number } | undefined;
			return row ? Number(row.value) : null;
		},

		async findBenchmark(age, categoryId, _tenantId) {
			// グローバル master (§11.2): tenant 述語なし (sqlite backend と同一契約)。
			const result = await db.execute(sql`
				SELECT ${BENCHMARK_COLUMNS} FROM market_benchmarks
				WHERE age = ${age} AND category_id = ${categoryId}
			`);
			const row = result.rows[0] as unknown as BenchmarkRow | undefined;
			return row ? toBenchmark(row) : undefined;
		},

		async findAllBenchmarks(_tenantId) {
			const result = await db.execute(sql`
				SELECT ${BENCHMARK_COLUMNS} FROM market_benchmarks
				ORDER BY age, category_id
			`);
			return (result.rows as unknown as BenchmarkRow[]).map(toBenchmark);
		},

		// biome-ignore lint/complexity/useMaxParams: interface 契約 (sqlite backend と同一、別 Issue でオブジェクト引数化予定)
		async upsertBenchmark(age, categoryId, mean, stdDev, source, _tenantId) {
			const result = await db.execute(sql`
				INSERT INTO market_benchmarks (age, category_id, mean, std_dev, source, updated_at)
				VALUES (${age}, ${categoryId}, ${mean}, ${stdDev}, ${source}, now())
				ON CONFLICT (age, category_id)
				DO UPDATE SET mean = ${mean}, std_dev = ${stdDev}, source = ${source}, updated_at = now()
				RETURNING ${BENCHMARK_COLUMNS}
			`);
			return toBenchmark(result.rows[0] as unknown as BenchmarkRow);
		},

		async findChildById(id, tenantId) {
			// #3709: 非 uuid の stale id は 22P02 throw ではなく not-found に正規化 (pg-uuid.ts 参照)。
			if (!isUuidFormat(id)) return undefined;
			const result = await db.execute(sql`
				SELECT ${CHILD_COLUMNS} FROM children
				WHERE family_id = ${tenantId} AND child_id = ${id}
			`);
			const row = result.rows[0] as unknown as ChildRow | undefined;
			return row ? toChild(row) : undefined;
		},

		async findLastActivityDates(childId, tenantId) {
			// 既存命名の歪み parity: category と命名されているが activityId keyed (interface 注記参照)。
			// DSQL は activity_id が uuid のため category は string で返る。
			const result = await db.execute(sql`
				SELECT activity_id, max(recorded_date) AS last_date FROM activity_logs
				WHERE family_id = ${tenantId} AND child_id = ${childId} AND cancelled = false
				GROUP BY activity_id
			`);
			return (result.rows as { activity_id: string; last_date: string | null }[]).map((r) => ({
				category: r.activity_id,
				lastDate: r.last_date,
			}));
		},

		async deleteByTenantId(tenantId) {
			// market_benchmarks はグローバル master のため削除しない (sqlite parity)。
			// 2 表削除を単一 txn で (fitness#7: work 内 await は tx.execute 直呼びのみ)。
			await runner.runInTransaction(async (tx) => {
				await tx.execute(sql`DELETE FROM status_history WHERE family_id = ${tenantId}`);
				await tx.execute(sql`DELETE FROM statuses WHERE family_id = ${tenantId}`);
			});
		},
	};
}
