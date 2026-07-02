// src/lib/server/db/dsql/record-activity-core.ts
// EPIC #3424 / 実装 #3541 (#N4-2 Phase C cycle 1) / 設計 SSOT: dsql-data-model.md §8 / §5(P7)
//
// recordActivity の core 5 行を単一 txn (all-or-nothing) で書く (§8「最大の質的改善」)。
// 現行 activity-log-service.ts の「txn 無し・逐次 await・例外握り潰し」による部分コミット
// (point 入ったが status 未更新等) を根絶する。
//
// 設計契約 (§8):
//   - **冪等性の正 = txn 内 re-read**: dailyLimit 判定 (countTodayActiveRecords 相当) を
//     txn 内で再実行。並行二連打は共有行 (mastery/statuses) upsert が serialization point に
//     なり DSQL では 40001 → runner retry → re-read が ALREADY_RECORDED を返す。
//     txn 境界を HTTP に晒さない (HTTP 再送は二重付与)。
//   - **point_ledger INSERT + children.total_point 加算は同一 txn** (§5 P7、SUM 乖離不能。
//     fitness#14 findTotalPointDrift が突合)。
//   - **optional (combo/mission/challenge/証明書/通知) は本関数に入れない** (SAVEPOINT 不可
//     spike#4。core commit 後の独立 mini-txn、cycle 2 / fitness#10,#11)。
//   - **fitness#7 準拠**: work 内の await は全て tx-bound。level 算出は sync 関数注入。
//   - work は再実行可能 (40001 retry で全体再実行、書込前の re-read が冪等性を守る)。
//
// 事前 guard (child/activity の存在・所有検証 CWE-598、streak/bonus 計算) は service 層の
// read-only 処理で、本関数の入力として受ける (txn 内は書込整合に必要な re-read のみ)。

import { sql } from 'drizzle-orm';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { SqlExecutor } from './sql-executor';

export interface RecordActivityCoreInput {
	familyId: string;
	childId: string;
	activityId: string;
	/** categories(code) 論理 FK。statuses/status_history の書込先カテゴリ。 */
	categoryId: string;
	/** 倍率 (メインクエスト/週末) 適用後の基礎点。 */
	basePoints: number;
	streakBonus: number;
	masteryBonus: number;
	streakDays: number;
	/** 'YYYY-MM-DD'。dailyLimit 判定と ledger.recorded_date に使用。 */
	recordedDate: string;
	/** ISO 8601。全 temporal 列に一貫適用 (テスト決定性)。 */
	now: string;
	/** null=1回 / 0=無制限 / N=N回 (現行 service と同義)。 */
	dailyLimit: number | null;
	/** point_ledger.description。 */
	description: string;
	/** status_history.change_type ('activity_record' 等)。 */
	changeType: string;
	/** 習熟度 count → level (sync。fitness#7: work 内 await 禁止のため関数注入)。 */
	masteryLevelFor: (totalCount: number) => number;
	/** 累積 XP → status level (sync)。 */
	statusLevelFor: (totalXp: number) => number;
}

export type RecordActivityCoreResult =
	| {
			ok: true;
			logId: string;
			totalPoints: number;
			masteryCount: number;
			masteryLevel: number;
			totalXp: number;
			statusLevel: number;
	  }
	| { ok: false; reason: 'ALREADY_RECORDED' | 'DAILY_LIMIT_REACHED' };

/** 業務失敗 (guard 不成立) を rollback とともに運ぶ内部シグナル。 */
class RecordAbort extends Error {
	constructor(readonly reason: 'ALREADY_RECORDED' | 'DAILY_LIMIT_REACHED') {
		super(`record aborted: ${reason}`);
	}
}

/** core 5 行 (log / mastery / ledger+total_point / statuses / history) を単一 txn で書く。 */
export async function recordActivityCore<TTx extends SqlExecutor>(
	runner: TransactionRunner<TTx>,
	input: RecordActivityCoreInput,
): Promise<RecordActivityCoreResult> {
	const {
		familyId,
		childId,
		activityId,
		categoryId,
		basePoints,
		streakBonus,
		masteryBonus,
		streakDays,
		recordedDate,
		now,
		dailyLimit,
		description,
		changeType,
		masteryLevelFor,
		statusLevelFor,
	} = input;
	const totalPoints = basePoints + streakBonus + masteryBonus;

	try {
		return await runner.runInTransaction(async (tx) => {
			// 冪等 guard: dailyLimit 判定を txn 内で re-read (§8。null=1回 / 0=無制限 / N=N回)。
			const counted = await tx.execute(sql`
				SELECT count(*) AS c FROM activity_logs
				WHERE family_id = ${familyId} AND child_id = ${childId}
					AND activity_id = ${activityId} AND recorded_date = ${recordedDate}
					AND cancelled = false
			`);
			const todayCount = Number((counted.rows[0] as { c: unknown }).c);
			const effectiveLimit = dailyLimit ?? 1;
			if (effectiveLimit !== 0 && todayCount >= effectiveLimit) {
				throw new RecordAbort(effectiveLimit === 1 ? 'ALREADY_RECORDED' : 'DAILY_LIMIT_REACHED');
			}

			// ① activity_logs INSERT (points は基礎点、bonus 内訳は streak_bonus 列 / ledger 側)。
			const inserted = await tx.execute(sql`
				INSERT INTO activity_logs
					(family_id, child_id, activity_id, points, streak_days, streak_bonus, recorded_date, recorded_at)
				VALUES (${familyId}, ${childId}, ${activityId}, ${basePoints}, ${streakDays}, ${streakBonus}, ${recordedDate}, ${now})
				RETURNING log_id
			`);
			const logId = (inserted.rows[0] as { log_id: string }).log_id;

			// ② activity_mastery: txn 内 re-read → count+1 → level 再計算 → upsert。
			const masteryRead = await tx.execute(sql`
				SELECT total_count FROM activity_mastery
				WHERE family_id = ${familyId} AND child_id = ${childId} AND activity_id = ${activityId}
			`);
			const masteryCount =
				Number((masteryRead.rows[0] as { total_count: number } | undefined)?.total_count ?? 0) + 1;
			const masteryLevel = masteryLevelFor(masteryCount);
			await tx.execute(sql`
				INSERT INTO activity_mastery (family_id, child_id, activity_id, total_count, level, updated_at)
				VALUES (${familyId}, ${childId}, ${activityId}, ${masteryCount}, ${masteryLevel}, ${now})
				ON CONFLICT (family_id, child_id, activity_id)
				DO UPDATE SET total_count = ${masteryCount}, level = ${masteryLevel}, updated_at = ${now}
			`);

			// ③ point_ledger INSERT + children.total_point 共更新 (§5 P7、同一 txn 必須)。
			await tx.execute(sql`
				INSERT INTO point_ledger (family_id, child_id, amount, type, description, reference_id, recorded_date, created_at)
				VALUES (${familyId}, ${childId}, ${totalPoints}, 'activity', ${description}, ${logId}, ${recordedDate}, ${now})
			`);
			await tx.execute(sql`
				UPDATE children SET total_point = total_point + ${totalPoints}, updated_at = ${now}
				WHERE family_id = ${familyId} AND child_id = ${childId}
			`);

			// ④ statuses: txn 内 re-read → XP 加算 + level/peak 再計算 → upsert。
			const statusRead = await tx.execute(sql`
				SELECT total_xp, peak_xp FROM statuses
				WHERE family_id = ${familyId} AND child_id = ${childId} AND category_id = ${categoryId}
			`);
			const prev = statusRead.rows[0] as { total_xp: number; peak_xp: number } | undefined;
			const totalXp = (prev?.total_xp ?? 0) + totalPoints;
			const peakXp = Math.max(prev?.peak_xp ?? 0, totalXp);
			const statusLevel = statusLevelFor(totalXp);
			await tx.execute(sql`
				INSERT INTO statuses (family_id, child_id, category_id, total_xp, level, peak_xp, updated_at)
				VALUES (${familyId}, ${childId}, ${categoryId}, ${totalXp}, ${statusLevel}, ${peakXp}, ${now})
				ON CONFLICT (family_id, child_id, category_id)
				DO UPDATE SET total_xp = ${totalXp}, level = ${statusLevel}, peak_xp = ${peakXp}, updated_at = ${now}
			`);

			// ⑤ status_history INSERT (recorded_at は sort 用途、§11.2)。
			await tx.execute(sql`
				INSERT INTO status_history (family_id, child_id, category_id, value, change_amount, change_type, recorded_at)
				VALUES (${familyId}, ${childId}, ${categoryId}, ${totalXp}, ${totalPoints}, ${changeType}, ${now})
			`);

			return {
				ok: true,
				logId,
				totalPoints,
				masteryCount,
				masteryLevel,
				totalXp,
				statusLevel,
			} as const;
		});
	} catch (err) {
		if (err instanceof RecordAbort) return { ok: false, reason: err.reason };
		throw err;
	}
}
