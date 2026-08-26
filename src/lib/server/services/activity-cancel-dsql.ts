// src/lib/server/services/activity-cancel-dsql.ts
// EPIC #3424 / #3596 ② (cancel atomicity) / 設計 SSOT: dsql-data-model.md §8
//
// DATA_SOURCE=dsql の cancelActivityLog 経路 (activity-log-service.ts から dispatch される):
//
//   1. 事前 guard (read-only、legacy と同一契約): findActivityLogById → 未存在/既 cancel は
//      NOT_FOUND、cancel window 超過は CANCEL_EXPIRED。findActivityById で categoryId 解決
//      (削除済は null で status 復元 skip = legacy `if (activity)` parity)。
//   2. core (log-cancel / mastery 復元 / point_ledger(−)+total_point / status 復元 / history) を
//      cancelActivityCore の単一 txn で all-or-nothing 書込。二重 cancel (2 連打) は core の
//      cancel UPDATE affected 判定 (§8) で ALREADY_CANCELLED → NOT_FOUND に写像 (legacy parity)。
//
// legacy (sqlite/dynamo/demo) 経路は activity-log-service.ts に温存。error 契約
// ({refundedPoints} / NOT_FOUND / CANCEL_EXPIRED) は backend 間で不変 (frontend 契約凍結)。
//
// fitness#7: 本 module に runInTransaction callsite は無い (txn は core 内)。

import { todayDateJST } from '$lib/domain/date-utils';
import {
	CANCEL_WINDOW_MS,
	calcMasteryBonusRefundOnCancel,
	calcMasteryLevel,
} from '$lib/domain/validation/activity';
import { calcLevelFromXp, clampDecayFloor } from '$lib/domain/validation/status';
import { findByChildAndActivity as findMastery } from '$lib/server/db/activity-mastery-repo';
import { findActivityById, findActivityLogById } from '$lib/server/db/activity-repo';
import { cancelActivityCore } from '$lib/server/db/dsql/cancel-activity-core';
import { getPgTransactionRunner } from '$lib/server/db/factory';
// #4686: optional 付与 (combo / mission / challenge / must / focus) の対称巻き戻し (sqlite 経路と共有)
import { revertOptionalAwardsOnCancel } from '$lib/server/services/activity-cancel-optional';

/**
 * DATA_SOURCE=dsql の活動キャンセル。error 契約 (NOT_FOUND / CANCEL_EXPIRED) と
 * 返却 shape ({ refundedPoints }) は sqlite 経路と同一 (frontend 契約不変)。
 */
export async function cancelActivityDsql(
	logId: string,
	tenantId: string,
): Promise<{ refundedPoints: number } | { error: 'NOT_FOUND' } | { error: 'CANCEL_EXPIRED' }> {
	// 1. 事前 guard (read-only、legacy と同一)
	const log = await findActivityLogById(logId, tenantId);
	if (!log) return { error: 'NOT_FOUND' };
	if (log.cancelled) return { error: 'NOT_FOUND' };

	const recordedTime = new Date(log.recordedAt).getTime();
	if (Date.now() - recordedTime > CANCEL_WINDOW_MS) {
		return { error: 'CANCEL_EXPIRED' };
	}

	// 返金額 = log.points + log.streak_bonus + mastery_bonus (#3787 対称返金)。記録時 ledger は
	// base+streak+mastery を計上するため、mastery_bonus も相殺しないと record→cancel farming で
	// balance に残る。mastery_bonus 額は付与時と同一式 (記録前 level) で再構成する (計算 SSOT = activity.ts)。
	// mastery 読取は refund 額算出用 (count 巻戻し自体は core が in-txn で実施)。
	const mastery = await findMastery(log.childId, log.activityId, tenantId);
	const masteryBonusRefund =
		mastery && mastery.totalCount > 0 ? calcMasteryBonusRefundOnCancel(mastery.totalCount) : 0;
	const refundPoints = log.points + log.streakBonus + masteryBonusRefund;

	// activity 削除済なら categoryId=null で status 復元を skip (legacy `if (activity)` parity)。
	const activity = await findActivityById(log.activityId, tenantId);

	// 2. core 単一 txn (冪等性の正 = cancel UPDATE の affected 判定、§8)
	const now = new Date().toISOString();
	const result = await cancelActivityCore(getPgTransactionRunner(), {
		familyId: tenantId,
		childId: String(log.childId),
		activityId: String(log.activityId),
		logId,
		categoryId: activity ? String(activity.categoryId) : null,
		refundPoints,
		recordedDate: todayDateJST(),
		now,
		description: 'キャンセル',
		changeType: 'activity_cancel',
		masteryLevelFor: calcMasteryLevel,
		// updateStatus の減衰 floor 契約を保存 (currentXp−refund ではなく peak*0.7 を下限とする)。
		revertStatusXp: (currentXp, peakXp) =>
			Math.max(0, clampDecayFloor(currentXp, refundPoints, peakXp)),
		statusLevelFor: (xp) => calcLevelFromXp(xp).level,
	});

	// 二重 cancel (並行 2 連打) は ALREADY_CANCELLED → NOT_FOUND に写像 (legacy: 既 cancel = NOT_FOUND)。
	if (!result.ok) return { error: 'NOT_FOUND' };

	// 3. optional 巻き戻し (#4686): core 確定後に、記録時 optional 付与の逆操作を隔離実行
	//    (record 経路の runOptionalWrite と同じ観測の形。失敗は core を巻き込まない)。
	await revertOptionalAwardsOnCancel({
		childId: log.childId,
		activityId: log.activityId,
		categoryId: activity ? activity.categoryId : null,
		today: todayDateJST(),
		tenantId,
	});

	return { refundedPoints: result.refundedPoints };
}
