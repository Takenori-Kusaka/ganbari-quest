// src/lib/server/db/interfaces/usage-log-repo.interface.ts
// #4719: 使用時間ログ (#1292) の backend 共通 interface。
// facade (usage-log-repo.ts) は factory (getRepos().usageLog) 経由で backend を選ぶ
// (sqlite 固定 import を残さない、#4680 class)。
import type { ChildId } from '$lib/domain/ids';

export interface UsageLog {
	/** backend の行 id (sqlite: 数値 id の文字列 / pg: uuid)。 */
	id: string;
	tenantId: string;
	childId: ChildId;
	/** ISO8601 UTC */
	startedAt: string;
	/** null = 進行中 */
	endedAt: string | null;
	durationSec: number | null;
}

export interface IUsageLogRepo {
	/** セッション開始を記録する。 */
	insertUsageLog(input: {
		tenantId: string;
		childId: ChildId;
		startedAt: string;
	}): Promise<UsageLog>;

	/**
	 * セッション終了を記録する (該当行なしは undefined)。
	 *
	 * `scopeChildId` を渡すと **WHERE に child 束縛を足す** (= 指定 child の行でなければ 1 行も
	 * 更新せず undefined)。child ロールの要求で「行 id だけで兄弟のセッションを終了させる」のを
	 * 止めるための複合キー化であり、**read してから判定するのではなく更新自体を絞る**
	 * (read → check → write だと判定前に ended_at を書いてしまう)。
	 */
	updateUsageLogEnd(
		id: string,
		endedAt: string,
		durationSec: number,
		tenantId: string,
		scopeChildId?: ChildId | null,
	): Promise<UsageLog | undefined>;

	/** 進行中 (ended_at NULL) セッションを全て endedAt で閉じる (cleanup)。 */
	closeOpenSessions(childId: ChildId, endedAt: string, tenantId: string): Promise<void>;

	/** startedAt >= startedAtFromIso のログ (テナント全子供)。 */
	findTodayUsageLogs(tenantId: string, startedAtFromIso: string): Promise<UsageLog[]>;

	/** [fromDate, toDate) の子供別ログ (startedAt 降順)。 */
	findUsageLogsByChildAndDateRange(
		childId: ChildId,
		tenantId: string,
		fromDate: string,
		toDate: string,
	): Promise<UsageLog[]>;

	/** テナントの全使用ログを削除する。 */
	deleteByTenantId(tenantId: string): Promise<void>;
}
