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
//   - 既存 pattern: discord-alert.ts の fire-and-forget 通知 (旧 license-key-service.ts は #2818 で削除済)
//
// 設計原則:
//   - **silent degradation 禁止**: silent fallback (silent return) は QM Adversarial security
//     軸の構造的指摘事項。alert kind=`stripe-lookup-failed` (warning level) で観測可能化。
//   - **fire-and-forget**: alert 失敗は課金 path をブロックしない (`void .catch(...)`)
//   - **Pre-PMF Bucket A 整合 (ADR-0010)**: Sentry SaaS 統合は別 Issue (現状 logger 経由のみ)、
//     本 module は Discord webhook + structured logger の 2 系統で最小カバレッジ

import { sendDiscordAlert } from '$lib/server/discord-alert';
import { logger } from '$lib/server/logger';
import { redactPii, redactPiiInTags } from '$lib/server/stripe/pii-redaction';

/**
 * Stripe 領域の Discord alert kind (Phase 6 子 5 §3 §6 SSOT)。
 *
 * 新規 kind 追加時は phase6-rollback-and-kill-switches.md §6 R1-R7 表に追記し、
 * 検知 method + ロールバック手順 + 再発防止の 3 観点 SSOT を維持する。
 */
export type StripeAlertKind =
	| 'stripe-lookup-failed'
	// #4026: 契約状態を書き換える event が、tenant の**現行契約とは別の** subscription を
	// 指していた。適用せず skip したうえで観測する (旧契約の後着 or tenant 同定ミス)。
	| 'stripe-contract-target-mismatch'
	| 'stripe-webhook-unknown-type'
	| 'stripe-webhook-handler-typeerror'
	// #3960: webhook payload から plan を確定できなかった。silent fallback で
	// 誤った plan を書き込む代わりに既存 plan を保持し、本 alert で観測可能化する。
	| 'stripe-plan-unresolved'
	// #3985: webhook handler が失敗した。dedup 台帳には残さず Stripe の再送に載せるため
	// (phase5-webhook-idempotency-architecture.md §4.2)、再送が 3 日で尽きる前に
	// 人が気づける導線として初回失敗の時点で alert する。
	| 'stripe-webhook-handler-failed'
	// #3980: subscription item が 2 件以上になった。plan 解決が前提にしている
	// 「item は常に 1 件」が崩れた瞬間を検知する (先頭参照そのものは維持)。
	| 'stripe-subscription-multi-item'
	// #3981: subscription から tenant を解決する経路が **障害で** 落ちた。
	// 「tenant が本当に不在」とは区別する (不在は warn のみで alert しない)。
	| 'stripe-context-unresolved'
	// #3959: webhook が Lambda に到達していない (沈黙) の検知。cron が 1 時間毎に Stripe API と
	// 自 DB を突き合わせて発火する。上の `stripe-webhook-handler-failed` は「到達したが handler が
	// 失敗した」側を所有し、本 kind とは発火条件が重ならない
	// (責務分界は stripe-webhook-delivery-monitor.ts 冒頭)。
	| 'stripe-webhook-undelivered'
	// #4128: Stripe 側は配信成功 (pending_webhooks=0) なのに、こちらの台帳に記録が無い。
	// 「受け取って 200 を返したのに処理していない」= silent drop の唯一の外形的証拠。
	// pending>0 を条件にする `stripe-webhook-undelivered` では原理的に検知できない領域を持つ。
	| 'stripe-webhook-ledger-gap'
	// #3959: 上の未達検知そのものが失敗した (Stripe API 障害 / DB 障害 等)。検知器が動いて
	// いない間は未達を見逃すため、検知器の停止自体を 1 つの障害として鳴らす。cron dispatcher は
	// 非 2xx を throw せず返すため Lambda の error alarm では表面化しない (#4102 QM 指摘 M3)。
	| 'stripe-webhook-monitor-failed';

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
 * tags を `key=value` 列の 1 行に畳む。
 *
 * **なぜ必要か (#4102 QM 指摘 M1)**: `logger` の `writeLog` は console に `message` 本文しか
 * 出さず `context` を捨てる (src/lib/server/logger.ts)。したがって triage 用の id を
 * structured context にだけ置くと、Lambda 上では CloudWatch にも Discord にも一切現れない。
 * runbook が「alert の `oldestEventId` を Stripe で開く」と書いても実行できない状態になるため、
 * 同じ内容を **人が読める 1 行**にして message 本文と Discord embed の両方に載せる。
 *
 * context への構造化出力は (logger を JSON 出力化したときに効くよう) 従来どおり併存させる。
 */
export function formatAlertTags(
	tags: Record<string, string | number | boolean> | undefined,
): string {
	if (!tags) return '';
	const entries = Object.entries(tags);
	if (entries.length === 0) return '';
	return entries.map(([key, value]) => `${key}=${value}`).join(' ');
}

/**
 * Stripe 領域専用 Discord alert (送信完了まで await できる版)。
 *
 * 動作:
 *   1. `logger.warn` で message 本文 + structured context (kind + tags) を出力
 *   2. `sendDiscordAlert` の完了まで待つ
 *
 * **await 版が要る理由 (#4102 QM 指摘 M2)**: Lambda はレスポンス返却後に実行環境が freeze
 * されるため、`void sendDiscordAlert(...)` の送信中 fetch はそのまま凍結されうる。HTTP request
 * 処理が続く経路では実質問題にならないが、**alert 送信が最終処理になる cron** では
 * 「送られないまま消える」ため、レスポンス前に完了させる必要がある。
 *
 * 本関数は throw しない (送信失敗は logger.warn に落とす)。呼び出し側の業務処理を
 * alert の失敗で壊さないため。
 */
export async function notifyStripeAlertAsync(options: StripeAlertOptions): Promise<void> {
	const { kind, message, errorSummary, tags } = options;

	// PII redaction (Issue #2738 / QA Adversarial security 軸 V-3 解消):
	//   Stripe error message に含まれる customer email / phone / card last4 を
	//   Discord webhook + structured logger 送信前に redact する。Stripe 内部 ID
	//   (cus_* / sub_* 等) は debug 用途で維持。
	const redactedMessage = redactPii(message);
	const redactedErrorSummary = errorSummary ? redactPii(errorSummary) : undefined;
	const redactedTags = redactPiiInTags(tags);
	// redact 済 tags から組み立てるため、本文に畳んでも PII は載らない
	const details = formatAlertTags(redactedTags);

	// 1. structured logger (CloudWatch Logs Insights 検索 key: `kind` / `tags.*`)
	//    message 本文にも details を畳む = console 出力しか見えない Lambda でも triage できる
	logger.warn(`[stripe-alert] ${kind}: ${redactedMessage}${details ? ` | ${details}` : ''}`, {
		service: 'stripe',
		context: {
			kind,
			...(redactedErrorSummary ? { errorSummary: redactedErrorSummary } : {}),
			...(redactedTags ?? {}),
		},
	});

	// 2. Discord alert。details は embed の Details field に出す (title は 200 文字で切られ、
	//    errorSummary は throttle key 兼用で毎回変わる値を入れられないため)
	try {
		await sendDiscordAlert({
			level: 'error',
			message: `[${kind}] ${redactedMessage}`,
			errorSummary: redactedErrorSummary ?? kind,
			details: details || undefined,
		});
	} catch (err) {
		// alert 自体の失敗は logger.warn で記録 (recursive alert を避ける)
		//   err.message にも PII が含まれる可能性があるため redact
		logger.warn(
			`[stripe-alert] Discord alert dispatch failed for ${kind}: ${redactPii(String(err))}`,
		);
	}
}

/**
 * Stripe 領域専用 Discord alert wrapper (fire-and-forget)。
 *
 * silent return しないことで kill switch fallback 発動時に observability gap を回避する
 * (QM Adversarial security 軸所見 #2720 直対処)。
 *
 * 課金 path (webhook handler / checkout 等) のように「この後もリクエスト処理が続く」経路向け。
 * **alert 送信が最後の処理になる cron からは `notifyStripeAlertAsync` を await すること**
 * (Lambda freeze で送信が消える、#4102 M2)。
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
	// notifyStripeAlertAsync は throw しないため .catch は不要 (送信失敗は内部で logger.warn)
	void notifyStripeAlertAsync(options);
}
