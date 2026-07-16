// src/lib/server/db/dsql/cancel-activity-core.ts
// EPIC #3424 / #3596 ② (cancel atomicity) / 設計 SSOT: dsql-data-model.md §8 / §5(P7)
//
// cancelActivity の core を単一 txn (all-or-nothing) で書く。record-activity-core.ts と対称。
// 現行 activity-log-service.ts cancelActivityLog の「txn 無し・逐次 4 await」による部分コミット
// (log は cancelled 化したが point 未返金 / status 戻したが ledger 未計上 等) を根絶する
// (§8。2026-07-15 restore 障害と同じ「共有行を跨ぐ非原子 write」class)。
//
// 設計契約 (§8):
//   - **冪等 guard = txn 内 cancel UPDATE の affected 行**: activity_logs を
//     `cancelled = false` 条件で UPDATE → RETURNING で affected を数える。2 連打 (同一 log の
//     二重 cancel) は同一行 UPDATE ゆえ DSQL 40001 → runner retry → 再実行時 cancelled=true で
//     0 行 → ALREADY_CANCELLED を返す (二重返金を serialization point で防ぐ)。txn 境界を HTTP に
//     晒さない。cancel 可否 (cancel window / NOT_FOUND) の事前判定は service 層 read-only。
//   - **point_ledger INSERT(−) + children.total_point 減算は同一 txn** (§5 P7、SUM 乖離不能。
//     fitness#14 findTotalPointDrift が突合)。child 不在なら throw で txn ごと rollback。
//   - **status 復元は clampDecayFloor 契約を保存する** (updateStatus の減衰 floor と parity):
//     currentXp − refundPoints ではなく revertStatusXp (= max(0, clampDecayFloor(currentXp,
//     refundPoints, peakXp))) を注入する。peak_xp は high-water mark ゆえ復元で減らさない。
//   - **categoryId=null (activity 削除済) は status 復元を skip** (legacy `if (activity)` parity)。
//   - **mastery は total_count>0 のときのみ count−1** (legacy `if (mastery && count>0)` parity)。
//   - **fitness#7 準拠**: work 内 await は全て tx.execute 直呼び。level/floor 算出は sync 注入。
//   - work は再実行可能 (40001 retry で全体再実行、cancel UPDATE の affected 判定が冪等性を守る)。
//
// **返金額の非対称メモ (#3596 ②)**: refundPoints は legacy と同一に log.points + log.streak_bonus
//   を service が算出する。記録時 ledger は base+streak+mastery_bonus を計上するため mastery_bonus
//   分は返金されない既存挙動を本 core は保存する (atomicity の是正のみが scope)。厳密な対称返金
//   (原 ledger 額の巻戻し) は別途 follow-up (#3596 の後続 or 新規) で扱う。

import { sql } from 'drizzle-orm';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type { SqlExecutor } from './sql-executor';

export interface CancelActivityCoreInput {
	familyId: string;
	childId: string;
	activityId: string;
	/** cancel 対象の activity_logs.log_id。 */
	logId: string;
	/** status/status_history 復元先カテゴリ。null=activity 削除済で status 復元を skip。 */
	categoryId: string | null;
	/** 返金額 (正の整数)。log.points + log.streak_bonus (legacy 同一計算、service が算出)。 */
	refundPoints: number;
	/** point_ledger.recorded_date ('YYYY-MM-DD'、冪等 lookup 用 §11.2)。cancel 実行日。 */
	recordedDate: string;
	/** ISO 8601。temporal 列に一貫適用 (テスト決定性)。 */
	now: string;
	/** point_ledger.description ('キャンセル')。 */
	description: string;
	/** status_history.change_type ('activity_cancel')。 */
	changeType: string;
	/** 習熟度 count → level (sync。fitness#7: work 内 await 禁止のため関数注入)。 */
	masteryLevelFor: (totalCount: number) => number;
	/** status XP 復元値算出 (sync)。= max(0, clampDecayFloor(currentXp, refundPoints, peakXp))。 */
	revertStatusXp: (currentXp: number, peakXp: number) => number;
	/** 復元後 XP → status level (sync)。 */
	statusLevelFor: (totalXp: number) => number;
}

export type CancelActivityCoreResult =
	| { ok: true; refundedPoints: number }
	| { ok: false; reason: 'ALREADY_CANCELLED' };

/** 冪等 guard 不成立 (既 cancel 済) を rollback とともに運ぶ内部シグナル。 */
class CancelAbort extends Error {
	constructor(readonly reason: 'ALREADY_CANCELLED') {
		super(`cancel aborted: ${reason}`);
	}
}

/** cancel core (log-cancel / mastery 復元 / ledger+total_point / status 復元 / history) を単一 txn で書く。 */
export async function cancelActivityCore<TTx extends SqlExecutor>(
	runner: TransactionRunner<TTx>,
	input: CancelActivityCoreInput,
): Promise<CancelActivityCoreResult> {
	const {
		familyId,
		childId,
		activityId,
		logId,
		categoryId,
		refundPoints,
		recordedDate,
		now,
		description,
		changeType,
		masteryLevelFor,
		revertStatusXp,
		statusLevelFor,
	} = input;

	try {
		return await runner.runInTransaction(async (tx) => {
			// ① 冪等 cancel guard + serialization anchor: cancelled=false のときだけ true 化。
			//    2 連打は同一行 UPDATE ゆえ 40001 → retry → 0 行 → ALREADY_CANCELLED (二重返金防止)。
			const cancelled = await tx.execute(sql`
				UPDATE activity_logs SET cancelled = true
				WHERE family_id = ${familyId} AND child_id = ${childId} AND log_id = ${logId}
					AND cancelled = false
				RETURNING log_id
			`);
			if (cancelled.rows.length === 0) {
				throw new CancelAbort('ALREADY_CANCELLED');
			}

			// ② activity_mastery: total_count>0 のとき count−1 → level 再計算 → upsert (legacy parity)。
			const masteryRead = await tx.execute(sql`
				SELECT total_count FROM activity_mastery
				WHERE family_id = ${familyId} AND child_id = ${childId} AND activity_id = ${activityId}
			`);
			const currentCount = Number(
				(masteryRead.rows[0] as { total_count: number } | undefined)?.total_count ?? 0,
			);
			if (currentCount > 0) {
				const revertedCount = currentCount - 1;
				const revertedLevel = masteryLevelFor(revertedCount);
				await tx.execute(sql`
					UPDATE activity_mastery SET total_count = ${revertedCount}, level = ${revertedLevel}, updated_at = ${now}
					WHERE family_id = ${familyId} AND child_id = ${childId} AND activity_id = ${activityId}
				`);
			}

			// ③ point_ledger INSERT(−) + children.total_point 減算 (§5 P7、同一 txn 必須)。
			await tx.execute(sql`
				INSERT INTO point_ledger (family_id, child_id, amount, type, description, reference_id, recorded_date, created_at)
				VALUES (${familyId}, ${childId}, ${-refundPoints}, 'cancel', ${description}, ${logId}, ${recordedDate}, ${now})
			`);
			const updatedChild = await tx.execute(sql`
				UPDATE children SET total_point = total_point - ${refundPoints}, updated_at = ${now}
				WHERE family_id = ${familyId} AND child_id = ${childId}
				RETURNING child_id
			`);
			if (updatedChild.rows.length === 0) {
				// child 不在 = total_point 共更新不能。throw で txn ごと rollback (§5 P7、片肺書込禁止)。
				throw new Error(`cancelActivityCore: child not found (${familyId}/${childId})`);
			}

			// ④ statuses 復元 (categoryId=null は activity 削除済で skip、legacy parity)。
			//    XP は clampDecayFloor 契約 (revertStatusXp)、peak_xp は減らさない (high-water mark)。
			if (categoryId !== null) {
				const statusRead = await tx.execute(sql`
					SELECT total_xp, peak_xp FROM statuses
					WHERE family_id = ${familyId} AND child_id = ${childId} AND category_id = ${categoryId}
				`);
				const prev = statusRead.rows[0] as { total_xp: number; peak_xp: number } | undefined;
				const currentXp = Number(prev?.total_xp ?? 0);
				const peakXp = Number(prev?.peak_xp ?? 0);
				const revertedXp = revertStatusXp(currentXp, peakXp);
				const revertedLevel = statusLevelFor(revertedXp);
				await tx.execute(sql`
					INSERT INTO statuses (family_id, child_id, category_id, total_xp, level, peak_xp, updated_at)
					VALUES (${familyId}, ${childId}, ${categoryId}, ${revertedXp}, ${revertedLevel}, ${peakXp}, ${now})
					ON CONFLICT (family_id, child_id, category_id)
					DO UPDATE SET total_xp = ${revertedXp}, level = ${revertedLevel}, peak_xp = ${peakXp}, updated_at = ${now}
				`);

				// ⑤ status_history INSERT (value=復元後 XP、change_amount=−refundPoints)。
				await tx.execute(sql`
					INSERT INTO status_history (family_id, child_id, category_id, value, change_amount, change_type, recorded_at)
					VALUES (${familyId}, ${childId}, ${categoryId}, ${revertedXp}, ${-refundPoints}, ${changeType}, ${now})
				`);
			}

			return { ok: true, refundedPoints: refundPoints } as const;
		});
	} catch (err) {
		if (err instanceof CancelAbort) return { ok: false, reason: err.reason };
		throw err;
	}
}
