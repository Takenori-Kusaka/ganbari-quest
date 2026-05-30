// src/lib/domain/archive-types.ts
//
// `archived_reason` enum SSOT (Phase 5 子 4 #2642 §2 原則 1 / Phase 6 子 3 #2675 §3.5 / Phase 7 PR-1)
//
// 3 経路統合の archive 機構で使う reason 値を **1 箇所** に集約する atom 定義。
// 値は内部識別子 (UI 露出禁止、ADR-0045) — 表示用ラベルは `labels.ts` の compound 側で組み立てる。
//
// 設計 SSOT:
// - docs/design/billing-redesign/phase5-archive-unified-architecture.md §2 原則 1 (atom)
// - docs/design/billing-redesign/phase6-db-migration-plan.md §3.5 (本 PR で新規 file)
// - docs/decisions/0049-retention-physical-delete-extended.md (free plan 90 日 retention)
// - docs/decisions/0045-terms-ssot-2-layer.md (atom / compound 責務分離)
//
// 関連:
// - `src/lib/server/db/schema.ts:40,70,109,430` で本 enum を `text(..., { enum: ... })` 制約に使用
// - `src/lib/server/db/sqlite/{child,activity,child-activity,checklist}-repo.ts` で書込み時に型強制 (Phase 7 PR-2a 以降)
// - `src/lib/server/services/resource-archive-service.ts` で 3 reason 統合 (Phase 7 PR-2a 以降)

/**
 * Archive 経路の reason 値 SSOT (3 経路統合)。
 *
 * - `trial_expired`: Reverse Trial 終了で自動 archive (`archiveExcessResources` 経路)
 * - `downgrade_user_selected`: 手動ダウン時にユーザー選択 archive (`archiveForDowngrade` 経路)
 * - `dunning_canceled`: dunning Smart Retries 枯渇 → subscription.deleted → free 復帰時 archive (Phase 7 新規)
 *
 * 順序は `as const` array の宣言順を保ち、`drizzle-orm` の enum 制約に渡したときに
 * SQLite CHECK 制約として展開される (drizzle-orm 0.x 仕様)。
 */
export const ARCHIVED_REASONS = [
	'trial_expired',
	'downgrade_user_selected',
	'dunning_canceled',
] as const;

/**
 * `ARCHIVED_REASONS` array の literal union 型。
 *
 * 用途: schema `text('archived_reason', { enum: ARCHIVED_REASONS })` の型推論で
 * drizzle-orm が自動的に本型を select / insert 型に伝播する。
 */
export type ArchivedReason = (typeof ARCHIVED_REASONS)[number];

/**
 * archived レコードの retention 期間 (日数) を reason 別に返す (ADR-0049 整合)。
 *
 * - `null` を返した reason は「自動物理削除しない」(運用判断、Pre-PMF Bucket A)
 * - Phase 7 PR-5 で retention cron が本関数を参照する
 *
 * 現状 (2026-05-30): Phase 7 PR-1 では schema 配備のみ、retention cron 実装は PR-5 以降。
 * 本 helper は archive-types.ts SSOT の一部として配備し、後続 PR の参照点を確定する。
 *
 * @param reason archive 起因
 * @returns retention 日数 (null = 自動削除なし)
 */
export function getRetentionDays(reason: ArchivedReason): number | null {
	switch (reason) {
		case 'trial_expired':
			// Reverse Trial 終了後の archived row。free 復帰なので ADR-0049 free plan 90 日整合
			return 90;
		case 'downgrade_user_selected':
			// 手動ダウン archive。free / paid 両方の経路があり得るため自動削除は保留 (運用判断)
			return null;
		case 'dunning_canceled':
			// dunning canceled → 強制 free 化。trial_expired と同型 (free plan 90 日)
			return 90;
	}
}
