import type { ChildId } from '$lib/domain/ids';
// src/lib/server/db/interfaces/reward-redemption-repo.interface.ts

export interface RedemptionRequestRow {
	id: string;
	childId: ChildId;
	rewardId: string;
	requestedAt: number;
	status: string;
	parentNote: string | null;
	resolvedAt: number | null;
	resolvedByParentId: string | null;
	shownToChildAt: number | null;
}

export interface RedemptionRequestWithDetails extends RedemptionRequestRow {
	childName: string;
	rewardTitle: string;
	rewardIcon: string | null;
	rewardPoints: number;
}

export interface RedemptionRequestWithReward extends RedemptionRequestRow {
	rewardTitle: string;
	rewardIcon: string | null;
}

/**
 * #3356 (1): 直近 approved 交換の重複排除窓 (秒)。同一 (child, reward) の approved 申請が
 * resolvedAt からこの窓内に存在する場合、新規申請を DUPLICATE_REQUEST で弾く。
 * 即時交換 (reward_auto_approve) の連打 / 再送 / 多タブによる「1 回のつもりが 2 回課金」を
 * server 側で遮断する idempotency 窓。意図的な連続購入は窓経過後に可能。
 */
export const REDEMPTION_DEDUP_WINDOW_SEC = 10;

export interface IRewardRedemptionRepo {
	/**
	 * 交換申請を作成する (#3356 (1) server-side idempotency 内蔵)。
	 *
	 * dedup 契約 — 以下のいずれかに該当する場合は行を作らず `{ error: 'DUPLICATE_REQUEST' }`:
	 *   (a) 同一 (childId, rewardId) の `pending_parent_approval` 申請が既存
	 *       (旧 findPendingByChildAndReward の check-then-act TOCTOU を repo 原子境界へ移設)
	 *   (b) 同一 (childId, rewardId) の `approved` 申請が resolvedAt >= now - REDEMPTION_DEDUP_WINDOW_SEC
	 *       に存在 (即時交換の連打で pending が瞬時に approved 化した直後の再送を遮断)
	 *
	 * 原子性: SQLite=同期 txn / DSQL・PGlite=children 行 FOR UPDATE で per-child 直列化
	 * (spendPointsAtomic と同パターン) / DynamoDB=pending marker item への条件付き Put を
	 * 申請 Put と同一 TransactWriteItems 化 ((b) は pre-read best-effort)。
	 */
	insertRedemptionRequest(
		input: { childId: ChildId; rewardId: string; requestedAt: number },
		tenantId: string,
	): Promise<RedemptionRequestRow | { error: 'DUPLICATE_REQUEST' }>;

	/**
	 * #3329 backup restore 用: 申請時点の全フィールド (status / 解決情報 / snapshot) を保全して
	 * 復元する。通常の insertRedemptionRequest は status を pending 固定 + live reward を引くため
	 * round-trip で承認済/却下/snapshot が失われる。本メソッドは export された値をそのまま書き戻す。
	 * id は新規採番 (元 id は保全しない、FK は呼び出し側が解決済の rewardId を渡す)。
	 *
	 * #3394 統一冪等契約: 永続化しなかった場合 (demo no-op stub) は **null** を返し、
	 * import カウント (rewardRedemptionsImported) を偽装しない (#2263 count 偽装 class)。
	 */
	insertRedemptionForRestore(
		input: {
			childId: ChildId;
			rewardId: string;
			requestedAt: number;
			status: string;
			parentNote: string | null;
			resolvedAt: number | null;
			resolvedByParentId: string | null;
			shownToChildAt: number | null;
			rewardTitle: string | null;
			rewardPoints: number | null;
			rewardIcon: string | null;
		},
		tenantId: string,
	): Promise<RedemptionRequestRow | null>;

	findRedemptionRequestsByChild(
		childId: ChildId,
		tenantId: string,
	): Promise<RedemptionRequestRow[]>;

	findRedemptionRequestsByTenant(
		tenantId: string,
		opts?: { status?: string; childId?: ChildId; limit?: number },
	): Promise<RedemptionRequestWithDetails[]>;

	/**
	 * #3144: テナント内の交換申請の正確な件数を返す (COUNT、limit なし)。
	 * findRedemptionRequestsByTenant は admin 一覧表示用に limit(50) を持つため件数算出に
	 * 流用すると 50 で飽和する。本メソッドは limit を掛けず正確な件数を返す。
	 */
	countRedemptionRequestsByTenant(
		tenantId: string,
		opts?: { status?: string; childId?: ChildId },
	): Promise<number>;

	/**
	 * #2845 課題①: full composite-key addressing。childId + id の複合キーで対象を直接
	 * 特定し、repo 入口で child 所有権を構造的に検証する。不一致なら undefined。
	 */
	updateRedemptionRequestStatus(
		childId: ChildId,
		id: string,
		updates: {
			status: string;
			parentNote?: string | null;
			resolvedAt?: number | null;
			resolvedByParentId?: string | null;
		},
		tenantId: string,
	): Promise<RedemptionRequestRow | undefined>;

	// findPendingByChildAndReward は #3356 (1) で撤去 (check-then-act TOCTOU の温床)。
	// pending 重複判定は insertRedemptionRequest の dedup 契約 (repo 原子境界) に内蔵済。

	findUnshownResultByChild(
		childId: ChildId,
		tenantId: string,
	): Promise<RedemptionRequestWithReward | undefined>;

	/** #2845 課題①: childId 所有権検証付き (composite key 直接特定)。不一致なら undefined。 */
	markRedemptionResultShown(
		childId: ChildId,
		id: string,
		tenantId: string,
	): Promise<RedemptionRequestRow | undefined>;

	expireOldRedemptions(tenantId: string): Promise<number>;

	hasPendingByReward(rewardId: string, tenantId: string): Promise<boolean>;

	deleteByTenantId(tenantId: string): Promise<void>;
}
