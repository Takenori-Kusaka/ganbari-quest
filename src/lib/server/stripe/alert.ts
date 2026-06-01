// src/lib/server/stripe/alert.ts
//
// Phase 7 PR-3b prerequisite / Issue #2720: Stripe 領域専用 Discord alert wrapper。
//
// 目的:
//   - kill switch silent degradation 防止: `getPriceId()` fallback 経路 (USE_LOOKUP_KEY=true
//     で lookup_key 解決失敗 → env var 救済成功) で観測不在になる risk を解消。
//   - 規定 alert key 3 種 (Phase 6 子 5 §3 §6 R1/R4/R5 SSOT) を type 安全に集約。
//   - structured logger context (Sentry tag 相当の検索 key) を統一。
//
// 設計 SSOT:
//   - docs/design/billing-redesign/phase6-rollback-and-kill-switches.md §3 §6 alert SSOT
//     (`stripe-webhook-unknown-type` / `stripe-lookup-failed` / `stripe-webhook-handler-typeerror`)
//   - docs/decisions/0059-phase7-cutover-sequence.md §「結果」§2 kill switch
//   - 既存 pattern: src/lib/server/services/license-key-service.ts L351 (fire-and-forget)
//
// 設計原則:
//   - **silent degradation 禁止**: silent fallback (silent return) は QM Adversarial security
//     軸の構造的指摘事項。alert kind=`stripe-lookup-failed` (warning level) で観測可能化。
//   - **fire-and-forget**: alert 失敗は課金 path をブロックしない (`void .catch(...)`)
//   - **Pre-PMF Bucket A 整合 (ADR-0010)**: Sentry SaaS 統合は別 Issue (現状 logger 経由のみ)、
//     本 module は Discord webhook + structured logger の 2 系統で最小カバレッジ

import { sendDiscordAlert } from '$lib/server/discord-alert';
import { logger } from '$lib/server/logger';

/**
 * Stripe 領域の Discord alert kind (Phase 6 子 5 §3 §6 SSOT)。
 *
 * 新規 kind 追加時は phase6-rollback-and-kill-switches.md §6 R1-R7 表に追記し、
 * 検知 method + ロールバック手順 + 再発防止の 3 観点 SSOT を維持する。
 */
export type StripeAlertKind =
	| 'stripe-lookup-failed'
	| 'stripe-webhook-unknown-type'
	| 'stripe-webhook-handler-typeerror';

export interface StripeAlertOptions {
	/** alert 種別 (Phase 6 子 5 §6 SSOT 3 種) */
	kind: StripeAlertKind;
	/** 観測対象の human-readable message (Discord embed title に展開) */
	message: string;
	/** error 詳細 (throttle key + stack 兼用、Discord embed Error field に展開) */
	errorSummary?: string;
	/** structured logger context (Sentry tag 相当の検索 key、CloudWatch Logs Insights で query 可能) */
	tags?: Record<string, string | number | boolean>;
}

/**
 * Stripe 領域専用 Discord alert wrapper (fire-and-forget)。
 *
 * 動作:
 *   1. `logger.warn` で structured context (kind + tags) を出力 (CloudWatch Logs Insights 検索可能)
 *   2. `sendDiscordAlert` を fire-and-forget で起動 (alert 失敗は課金 path をブロックしない)
 *
 * silent return しないことで kill switch fallback 発動時に observability gap を回避する
 * (QM Adversarial security 軸所見 #2720 直対処)。
 *
 * @param options - alert kind + message + structured tags
 *
 * @example
 *   // getPriceId() fallback 経路の使用例:
 *   notifyStripeAlert({
 *     kind: 'stripe-lookup-failed',
 *     message: 'lookup_key 解決失敗 → env var fallback 起動 (kill switch 動作)',
 *     errorSummary: `lookup_failed:${lookupKey}`,
 *     tags: { lookupKey, plan, interval, fallbackUsed: true },
 *   });
 */
export function notifyStripeAlert(options: StripeAlertOptions): void {
	const { kind, message, errorSummary, tags } = options;

	// 1. structured logger (CloudWatch Logs Insights 検索 key: `kind` / `tags.*`)
	//    Sentry SaaS 統合は別 Issue だが、本 logger output は CloudWatch Logs Insights で
	//    `fields @timestamp, kind, message | filter kind = "stripe-lookup-failed"` で query 可能
	logger.warn(`[stripe-alert] ${kind}: ${message}`, {
		service: 'stripe',
		context: {
			kind,
			...(errorSummary ? { errorSummary } : {}),
			...(tags ?? {}),
		},
	});

	// 2. Discord alert (fire-and-forget、課金 path をブロックしない)
	//    既存 license-key-service.ts L351 pattern 整合
	void sendDiscordAlert({
		level: 'error',
		message: `[${kind}] ${message}`,
		errorSummary: errorSummary ?? kind,
	}).catch((err) => {
		// alert 自体の失敗は logger.warn で記録 (recursive alert を避ける)
		logger.warn(`[stripe-alert] Discord alert dispatch failed for ${kind}: ${String(err)}`);
	});
}
