// src/lib/server/stripe/pii-redaction.ts
//
// Issue #2738 / PR #2727 prerequisite / Phase 7 PR-3b BLOCK V-3 解消:
// Stripe error message に含まれる顧客 PII を Discord/Sentry 送信前に redact する。
//
// 目的:
//   - QA Adversarial security 軸 (BLOCK V-3): Stripe error message に customer email
//     / phone / card last4 等の PII が含まれる場合、Discord webhook + structured logger
//     経由で外部観測点に流出する risk を Bucket A critical (#2738) として解消。
//   - notifyStripeAlert (alert.ts) の fire-and-forget path 専用、Stripe error 観測
//     用途に limit (汎用 logging 全般への適用は本 PR scope 外、過剰防衛回避)。
//
// 設計 SSOT:
//   - docs/design/billing-redesign/phase6-rollback-and-kill-switches.md §5 alert SSOT
//   - PR #2727 (notifyStripeAlert fire-and-forget wrapper) と統合
//   - memory `feedback_billing_critical_extra_caution` 整合 (Bucket A critical)
//
// OSS 先調査 (ADR-0014 / #1350 整合):
//   - npm `pii-redactor` (週 ~200DL、最終更新 2021): 採用実績乏しく Pre-PMF 過剰
//   - npm `@privacy-aware/pii-redact`: 採用実績ほぼゼロ
//   - gitleaks: CLI のみ、library API 非提供
//   → Stripe error 観測用途 + redaction 対象 3 種 (email / phone / card last4) のみで
//     独自実装が ADR-0014 「OSS 採用コスト > Pre-PMF benefit」基準で適合。
//     正規表現 3 パターンのみで実装は ~30 行に収まる。
//
// 設計原則:
//   - **false negative (redaction 漏れ) を最大 risk**: 過剰 redact (false positive)
//     は debug 不便だが流出には繋がらない。失敗時は安全側に倒す。
//   - **Stripe customer ID (`cus_*`) 等の Stripe 内部 ID は維持**: debug 用途に必須、
//     PII ではない (Stripe 公式 ID handling 推奨)。
//   - **performance < 1ms / call**: alert path は課金 path をブロックしない必須要件
//     (notifyStripeAlert §設計原則 fire-and-forget 整合)。

export const PII_REDACTION_MARKERS = {
	EMAIL: '<EMAIL_REDACTED>',
	PHONE: '<PHONE_REDACTED>',
	CARD: '<CARD_REDACTED>',
} as const;

/**
 * email 検出: RFC 5322 簡略版 (Stripe error message 典型形に最適化、完全準拠は過剰)。
 * Stripe 公式 error message には `customer email: foo@example.com` 等の形式で
 * 顧客 email が含まれる事例あり (Stripe Docs: error.payment_method.billing_details.email)。
 */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * phone 検出: 国際形式 (+81 ...) + 日本国内形式 (0X-XXXX-XXXX / 0XXXXXXXXXX)。
 * Stripe Customer phone field は E.164 形式 (+ 国番号) を要求するため + 始まりを主に検出。
 * 数値 10-15 桁の連続列も検出 (区切り文字 - / space 許容)。
 */
const PHONE_PATTERN =
	/(?:\+\d{1,3}[\s-]?)?(?:\(\d{1,4}\)[\s-]?)?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{3,4}/g;

/**
 * card last4 検出: Stripe error message に「card ending in 4242」「last4: 4242」
 * 「****4242」等の形式で card 末尾 4 桁が露出する事例あり (Stripe Docs:
 * payment_method.card.last4)。card フルナンバー (13-19 桁) は Stripe が API
 * 経由で生で返さないが、Luhn 検証含めず保守的に 13-19 桁連続数字も検出。
 */
const CARD_LAST4_PATTERN = /(?:ending in |last4[:\s]+|\*{4,}\s*)\d{4}/gi;
const CARD_FULL_PATTERN = /\b\d{13,19}\b/g;

/**
 * Stripe error message + arbitrary string から PII を redact する。
 *
 * - email → `<EMAIL_REDACTED>`
 * - phone → `<PHONE_REDACTED>`
 * - card last4 / full → `<CARD_REDACTED>`
 *
 * Stripe 内部 ID (`cus_*` / `sub_*` / `price_*` / `pi_*` 等) は対象外、維持される
 * (PII ではなく debug に必須)。
 *
 * @param input - redact 対象文字列 (undefined / null 入力時は空文字を返す)
 * @returns redact 済文字列
 *
 * @example
 *   redactPii('customer email foo@example.com card ending in 4242')
 *   // => 'customer email <EMAIL_REDACTED> card <CARD_REDACTED>'
 */
export function redactPii(input: string | undefined | null): string {
	if (input === undefined || input === null || input === '') return '';
	return String(input)
		.replace(EMAIL_PATTERN, PII_REDACTION_MARKERS.EMAIL)
		.replace(CARD_LAST4_PATTERN, PII_REDACTION_MARKERS.CARD)
		.replace(CARD_FULL_PATTERN, PII_REDACTION_MARKERS.CARD)
		.replace(PHONE_PATTERN, PII_REDACTION_MARKERS.PHONE);
}

/**
 * structured logger tags / context object の string value のみを redact する。
 * 数値 / boolean / Stripe ID 文字列 (cus_* / sub_* / price_* / pi_*) は維持。
 *
 * @param tags - structured tags (string | number | boolean value)
 * @returns redact 済 tags (shape 維持)
 */
export function redactPiiInTags(
	tags: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> | undefined {
	if (tags === undefined) return undefined;
	const redacted: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(tags)) {
		if (typeof value === 'string') {
			// Stripe 内部 ID は維持 (debug に必須、PII ではない)
			if (/^(?:cus|sub|price|pi|in|ch|seti|src|tok|prod|evt)_[A-Za-z0-9]+$/.test(value)) {
				redacted[key] = value;
			} else {
				redacted[key] = redactPii(value);
			}
		} else {
			redacted[key] = value;
		}
	}
	return redacted;
}
