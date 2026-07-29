// src/lib/domain/checkout-reconciliation.ts
// #3958: checkout 完了照合 — クライアント/サーバー共有型
//
// 実体 (Stripe への照会 + 反映) は `$lib/server/services/stripe-service` の
// `reconcileCheckoutSession`。型だけを domain に置き、UI 側が server module を
// import せずに結果を扱えるようにする。

/**
 * `success_url` の `session_id` を照合した結果。
 *
 * - `applied` — 未反映だった契約を本経路で反映した (webhook 未達の救済が成立)
 * - `already_applied` — 既に同じ subscription が反映済み (書き込み・通知とも発生していない)
 * - `pending` — Stripe 上まだ支払いが確定していない
 * - `tenant_mismatch` — session の `metadata.tenantId` がログイン中 tenant と一致しない
 * - `not_found` — session_id 不正 / Stripe に存在しない / 期限切れ / tenant 不在
 * - `unavailable` — Stripe 連携が無効な環境 (NUC / local)
 */
export type CheckoutReconciliationStatus =
	| 'applied'
	| 'already_applied'
	| 'pending'
	| 'tenant_mismatch'
	| 'not_found'
	| 'unavailable';

export interface CheckoutReconciliationResult {
	status: CheckoutReconciliationStatus;
}
