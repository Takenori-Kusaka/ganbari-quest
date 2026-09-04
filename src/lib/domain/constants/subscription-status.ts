// src/lib/domain/constants/subscription-status.ts
// #972: Tenant.status (Stripe 連動のテナント購読状態) の SSOT。
// Stripe subscription の状態をアプリ内の状態機械に落とし込んだもの。
//
// 遷移 (ADR-0022):
//   active → grace_period (支払い失敗の猶予期間)
//          → suspended (猶予期間経過で機能停止 / 解約確定)
//   cancel_at_period_end で suspended に移行する経路もある
//   terminated (退会済) への遷移は本図に無い — 現在は書き手が存在せず legacy 行としてのみ残りうる (#3987)

export const SUBSCRIPTION_STATUS = {
	/** 購読中 (Stripe subscription active) */
	ACTIVE: 'active',
	/** 支払い失敗の猶予期間 (past_due 相当) */
	GRACE_PERIOD: 'grace_period',
	/** 機能停止 (猶予経過後 / cancel_at_period_end 通過後 / 解約確定) */
	SUSPENDED: 'suspended',
	/**
	 * 退会 (アカウント削除) 済み。**解約ではない** (#3987)。
	 *
	 * 意味の SSOT は読み手 3 箇所が一致して示している:
	 * - `hooks.server.ts` — 本 status のテナントを完全ブロックし
	 *   `/auth/login?reason=deleted` へ飛ばす / API は「アカウントは削除済みです。」を返す
	 * - `auth-license-status.ts` — `terminated` → `licenseStatus='none'`
	 * - `SaasLicensePanel.svelte` — `SUBSCRIPTION_PAGE_LABELS.statusTerminated` を表示
	 *
	 * **通常運用では書かれない**。退会の物理削除 (`purgeExpiredSoftDeletedTenants` →
	 * `deleteOwnerOnlyAccount` / `deleteOwnerFullDelete`) は `deleteTenant()` で families 行
	 * ごと消すため、status を保持する行が残らない (contract-state-matrix §4 S6)。
	 * 残りうるのは legacy 行と手動介入のみで、その行を締め出すための防御として本値を保つ。
	 *
	 * **チャーン KPI をこの値だけで数えてはならない** — 恒常的に 0 になる。
	 * 解約の判定は {@link isChurnedContract} を使う (#3987)。
	 */
	TERMINATED: 'terminated',
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const ALL_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
	SUBSCRIPTION_STATUS.ACTIVE,
	SUBSCRIPTION_STATUS.GRACE_PERIOD,
	SUBSCRIPTION_STATUS.SUSPENDED,
	SUBSCRIPTION_STATUS.TERMINATED,
] as const;

/** 機能が利用可能な status (active + 猶予期間中) */
export const ENTITLED_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
	SUBSCRIPTION_STATUS.ACTIVE,
	SUBSCRIPTION_STATUS.GRACE_PERIOD,
] as const;

export function isEntitledStatus(status: SubscriptionStatus): boolean {
	return ENTITLED_SUBSCRIPTION_STATUSES.includes(status);
}

export function isSubscriptionActive(status: SubscriptionStatus): boolean {
	return status === SUBSCRIPTION_STATUS.ACTIVE;
}

export function isSubscriptionSuspended(status: SubscriptionStatus): boolean {
	return status === SUBSCRIPTION_STATUS.SUSPENDED;
}

export function isSubscriptionTerminated(status: SubscriptionStatus): boolean {
	return status === SUBSCRIPTION_STATUS.TERMINATED;
}

/**
 * チャーン (契約終了) 判定の SSOT (#3987)。
 *
 * `families` は「status 単独」では解約を表現できない。`suspended` が 2 つの状態を兼ねるため:
 *
 * | 状態 | `status` | `sub` | 意味 | チャーン |
 * |---|---|---|---|---|
 * | S4 停止 | `suspended` | **あり** | Stripe が `unpaid` / `incomplete` 等。契約は残り復帰しうる | **数えない** |
 * | S5 契約終了 | `suspended` | **なし** | 解約が確定し subscription 割り当てが解けた (`TERMINAL_CONTRACT_STATE`) | **数える** |
 * | S6 退会済 | `terminated` | 任意 | 退会 (アカウント削除)。通常運用では行ごと消えるため観測されない | 数える (legacy 行の救済) |
 *
 * `status === TERMINATED` だけで数えると **恒常的に 0** になる (S6 の行は残らない)。
 * 逆に `suspended` を丸ごと数えると復帰しうる S4 を解約に混ぜてしまう。
 *
 * 契約状態の組み合わせ SSOT は `docs/design/billing-redesign/contract-state-matrix.md` §4。
 * 本判定を経由しない直接比較は
 * `tests/unit/architecture/churn-status-predicate-ssot.test.ts` が禁止する
 * (ADR-0061 fitness function — 4 つ目の独自定義が生まれるのを防ぐ)。
 */
export function isChurnedContract(tenant: {
	status: SubscriptionStatus;
	stripeSubscriptionId?: string | null;
}): boolean {
	if (tenant.status === SUBSCRIPTION_STATUS.TERMINATED) return true;
	return tenant.status === SUBSCRIPTION_STATUS.SUSPENDED && tenant.stripeSubscriptionId == null;
}

/**
 * S4 (契約が残ったままの停止) 判定の SSOT。
 *
 * `isChurnedContract` の裏側 — `suspended` が兼ねる 2 状態のうち、
 * **subscription 割り当てが解けていない側**だけを指す:
 *
 * | 状態 | `status` | `sub` | 本述語 |
 * |---|---|---|---|
 * | S4 停止 | `suspended` | **あり** | **true** — 契約は残り、`invoice.paid` (W2) で S2 に戻りうる |
 * | S5 契約終了 | `suspended` | なし | false — 解約が確定した終端 (`isChurnedContract` が true) |
 * | S6 退会済 | `terminated` | 任意 | false — 同上 |
 * | S1 / S2 / S3 | `active` / `grace_period` | — | false |
 *
 * **用途**: 「戻ってくる前提の状態で、戻らない処理 (履歴の物理削除) を先に実行しない」
 * ための境界 (PO 決定 2026-09-04)。S4 は `deriveLicenseStatus` で `suspended` →
 * `resolvePlanTier` が `free` に落ちるため、放置すると**契約が生きているうちに**
 * 無料プランの cutoff で `activity_logs` / `point_ledger` / `status_history` が消える。
 * 有料機能を止めるところまでが未収への手当てで、不可逆な削除まで前倒しする理由がない。
 *
 * plan tier の解決そのもの (`resolvePlanTier`) は変えない — 課金ゲート全体に波及し、
 * 未収のテナントに有料機能を返してしまう。止めるのは削除を実行する側 (retention-cleanup)。
 *
 * 契約状態の組み合わせ SSOT は `docs/design/billing-redesign/contract-state-matrix.md` §4。
 */
export function isRetainedSuspendedContract(tenant: {
	status: SubscriptionStatus;
	stripeSubscriptionId?: string | null;
}): boolean {
	return tenant.status === SUBSCRIPTION_STATUS.SUSPENDED && tenant.stripeSubscriptionId != null;
}
