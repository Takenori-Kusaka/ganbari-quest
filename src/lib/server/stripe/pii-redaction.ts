// src/lib/server/stripe/pii-redaction.ts
//
// Issue #2738 / PR #2727 prerequisite / Phase 7 PR-3b BLOCK V-3 解消:
// Stripe error message に含まれる顧客 PII を Discord/Sentry 送信前に redact する。
//
// Issue #2749 (本 PR、PR #2747 Adversarial security 軸 critical follow-up、
// Phase 7 PR-3b cutover gate):
//   PR #2747 配備の PII redaction が **3 種の bypass で false negative** を起こす
//   ことが Adversarial Reviewer security 軸 critical で検出された:
//     (1) Unicode email bypass (全角英数 / Mathematical Alphanumeric Symbols /
//         Cyrillic look-alike で email regex `[A-Za-z0-9@]` がマッチしない)
//     (2) IDN bypass (`xn--` punycode domain で latin domain regex が bypass される)
//     (3) credit card 分割表記 bypass (`4242 4242 4242 4242` の space 区切り
//         16 桁を `\b\d{13,19}\b` が捕捉しない)
//   本リファクタで 3 種すべてに対応 (詳細は AC1 / AC2 / AC3 / AC4 セクション参照)。
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
//     + §5.7 PII redaction Unicode bypass 対策 (本 PR 追記)
//   - PR #2727 (notifyStripeAlert fire-and-forget wrapper) と統合
//   - memory `feedback_billing_critical_extra_caution` 整合 (Bucket A critical)
//
// OSS 先調査 (ADR-0014 / #1350 整合):
//   - npm `pii-redactor` (週 ~200DL、最終更新 2021): 採用実績乏しく Pre-PMF 過剰
//   - npm `@privacy-aware/pii-redact`: 採用実績ほぼゼロ
//   - gitleaks: CLI のみ、library API 非提供
//   - Unicode NFKC 正規化: ECMAScript 標準 `String.prototype.normalize('NFKC')`
//     (Unicode Standard Annex #15) で全角 → 半角 + Mathematical Alphanumeric →
//     Latin の compatibility decomposition が library 不要で実現可能
//   → Stripe error 観測用途 + redaction 対象 3 種 (email / phone / card last4) のみで
//     独自実装が ADR-0014 「OSS 採用コスト > Pre-PMF benefit」基準で適合。
//     NFKC 正規化 + 既存 regex の組合せで実装は ~60 行に収まる。
//
// 設計原則:
//   - **false negative (redaction 漏れ) を最大 risk**: 過剰 redact (false positive)
//     は debug 不便だが流出には繋がらない。失敗時は安全側に倒す。
//   - **Stripe customer ID (`cus_*`) 等の Stripe 内部 ID は維持**: debug 用途に必須、
//     PII ではない (Stripe 公式 ID handling 推奨)。
//   - **performance < 1ms / call**: alert path は課金 path をブロックしない必須要件
//     (notifyStripeAlert §設計原則 fire-and-forget 整合)。NFKC 正規化追加後も
//     1000 call < 100ms の baseline を維持 (Issue #2749 AC、unit test で assertion)。

export const PII_REDACTION_MARKERS = {
	EMAIL: '<EMAIL_REDACTED>',
	PHONE: '<PHONE_REDACTED>',
	CARD: '<CARD_REDACTED>',
	IDN: '<IDN_REDACTED>',
} as const;

/**
 * email 検出: RFC 5322 簡略版 (Stripe error message 典型形に最適化、完全準拠は過剰)。
 * Stripe 公式 error message には `customer email: foo@example.com` 等の形式で
 * 顧客 email が含まれる事例あり (Stripe Docs: error.payment_method.billing_details.email)。
 *
 * Issue #2749 AC1 補強: NFKC 正規化後の半角化された ASCII に対して match させる。
 * 正規化前後の双方を redact 対象に追加し、原文側からも対応位置を消す。
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
 * payment_method.card.last4)。
 */
const CARD_LAST4_PATTERN = /(?:ending in |last4[:\s]+|\*{4,}\s*)\d{4}/gi;

/**
 * Issue #2749 AC3 補強: card フルナンバー検出を space / hyphen 区切り耐性に拡張。
 *
 * `4242 4242 4242 4242` / `4242-4242-4242-4242` / `4242424242424242` の 3 形態を
 * 同一 token として捕捉する。digit + 区切り文字 1 つ以下のシーケンスが 13-19 桁の
 * digit を持つ場合に match させ、Luhn check 合格 (= 妥当 card 番号) のみ redact する
 * (false positive を防ぐ — 通常の 16 桁 ID は Luhn を通常通らない、
 * 正常な Stripe API key prefix `sk_test_` 等は数値部分が分断されるため match しない)。
 *
 * Pattern: 4-19 桁の digit-cluster で、間に最大 1 つの space / hyphen を許容。
 * 4 桁開始 (最短 card BIN 前 4 桁) で実用範囲を絞り過検出を抑制。
 */
const CARD_SPACED_PATTERN = /\b\d{4}(?:[\s-]?\d){9,15}\b/g;

/**
 * Issue #2749 AC2: IDN (Internationalized Domain Name) 検出。
 *
 * `xn--` プレフィックスを持つ punycode-encoded ASCII domain は ASCII 内で Unicode
 * domain を表現するため、通常の email regex `[A-Za-z0-9.-]+\.[A-Za-z]{2,}` で
 * **構造的には match する**ことが多い。ただし IDN homograph attack (例:
 * `xn--80ak6aa92e.com` = `аррӏе.com` Cyrillic look-alike) で email regex を
 * すり抜けて顧客 PII (具体 email) が露出する経路が残るため、**`xn--` を含む
 * token を独立に検出し redact**する。
 *
 * Pattern: word boundary 開始 → `xn--` literal → 残り label 文字 (alnum + hyphen)
 * + ドメイン区切り (dot) + TLD (alpha)。複数 label IDN にも match させるため
 * dot を許容する。
 */
const IDN_PATTERN = /\bxn--[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

/**
 * Issue #2749 AC1: Unicode homograph 検知用 — Cyrillic / Greek look-alike を
 * Latin に variant fold する mini-table。`@` 検知が NFKC 正規化単独では潰せない
 * (Cyrillic 文字は NFKC で Latin に decompose されない) ため、redaction の前段で
 * 「visually identical to Latin」の Cyrillic + Greek 文字を対応する Latin に置換。
 *
 * 完全な Unicode TR39 confusables list は ~30KB あり Pre-PMF 過剰 (ADR-0010)
 * なので、**Stripe error / 課金 path で実用される ASCII 文字 (a-z 0-9 @ .) を
 * 表現する Cyrillic / Greek 文字のみ**に限定。
 *
 * 出典: Unicode Technical Report #39 "Unicode Security Mechanisms" §4 confusables
 * (https://www.unicode.org/reports/tr39/) の代表的 Latin look-alike。
 */
const HOMOGLYPH_MAP: Record<string, string> = {
	// Cyrillic lowercase → Latin
	а: 'a', // U+0430
	е: 'e', // U+0435
	о: 'o', // U+043E
	р: 'p', // U+0440
	с: 'c', // U+0441
	у: 'y', // U+0443
	х: 'x', // U+0445
	і: 'i', // U+0456 (Ukrainian)
	ј: 'j', // U+0458
	ѕ: 's', // U+0455
	// Cyrillic uppercase → Latin
	А: 'A',
	В: 'B',
	Е: 'E',
	К: 'K',
	М: 'M',
	Н: 'H',
	О: 'O',
	Р: 'P',
	С: 'C',
	Т: 'T',
	Х: 'X',
	У: 'Y',
	// Greek lowercase → Latin (visually identical subset)
	α: 'a', // U+03B1
	ο: 'o', // U+03BF
	ρ: 'p', // U+03C1
	ν: 'v', // U+03BD (visually similar)
	// Greek uppercase → Latin
	Α: 'A',
	Β: 'B',
	Ε: 'E',
	Ζ: 'Z',
	Η: 'H',
	Ι: 'I',
	Κ: 'K',
	Μ: 'M',
	Ν: 'N',
	Ο: 'O',
	Ρ: 'P',
	Τ: 'T',
	Υ: 'Y',
	Χ: 'X',
};

/**
 * Issue #2749 AC1: Cyrillic / Greek look-alike を Latin に variant fold する。
 * NFKC では潰せない script-level homograph に対応。
 *
 * @internal — テスト時 export 用、本番は redactPii 経由でのみ呼ばれる
 */
function foldHomoglyphs(input: string): string {
	let out = '';
	for (const ch of input) {
		out += HOMOGLYPH_MAP[ch] ?? ch;
	}
	return out;
}

/**
 * Issue #2749 AC3: Luhn algorithm で credit card 番号妥当性を検証。
 *
 * `digits` (純数字文字列) が Luhn check を通る = 実在し得る card 番号形式。
 * 通常の 16 桁 ID / phone E.164 / 数値文字列は Luhn を通さない (確率 1/10) ため、
 * spaced card pattern match の false positive 抑制に有効。
 *
 * @param digits - 区切り文字を除去した数字のみ文字列 (length 13-19)
 * @returns Luhn check 合格なら true
 */
function isValidLuhn(digits: string): boolean {
	if (digits.length < 13 || digits.length > 19) return false;
	let sum = 0;
	let alt = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		const code = digits.charCodeAt(i);
		if (code < 48 || code > 57) return false;
		let n = code - 48;
		if (alt) {
			n *= 2;
			if (n > 9) n -= 9;
		}
		sum += n;
		alt = !alt;
	}
	return sum % 10 === 0;
}

/**
 * Stripe error message + arbitrary string から PII を redact する。
 *
 * - email → `<EMAIL_REDACTED>`
 * - phone → `<PHONE_REDACTED>`
 * - card last4 / full / spaced (Luhn 合格) → `<CARD_REDACTED>`
 * - IDN (`xn--` punycode domain) → `<IDN_REDACTED>` (Issue #2749 AC2)
 *
 * Issue #2749 で bypass 3 種に対応:
 *   AC1: NFKC 正規化 + Cyrillic/Greek homograph variant fold で全角 / Math
 *        Alphanumeric / Cyrillic look-alike email を redact
 *   AC2: `xn--` punycode IDN を独立検出して redact
 *   AC3: `4242 4242 4242 4242` 等 space/hyphen 区切り card を Luhn 合格時のみ redact
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
 *
 *   // Issue #2749 AC1: 全角 / Cyrillic look-alike も bypass されない
 *   redactPii('ｆｏｏ＠example.com')
 *   // => '<EMAIL_REDACTED>'
 *   redactPii('fοο@example.com') // ο = Greek omicron
 *   // => '<EMAIL_REDACTED>'
 *
 *   // Issue #2749 AC2: IDN
 *   redactPii('email user@xn--80ak6aa92e.com')
 *   // => 'email <IDN_REDACTED>' (IDN domain 全体を redact)
 *
 *   // Issue #2749 AC3: space-separated card
 *   redactPii('4242 4242 4242 4242 was declined')
 *   // => '<CARD_REDACTED> was declined'
 */
export function redactPii(input: string | undefined | null): string {
	if (input === undefined || input === null || input === '') return '';
	// Step 1: Unicode NFKC 正規化 (AC1) — 全角英数 / Math Alphanumeric →
	// Latin ASCII の compatibility decomposition。
	// Step 2: Cyrillic / Greek homograph fold (AC1) — NFKC 単独では潰せない
	// script-level look-alike を Latin に variant fold。
	const normalized = foldHomoglyphs(String(input).normalize('NFKC'));

	// Step 3: Luhn 合格判定を伴う card spaced pattern 置換 (AC3)。
	// match した token から区切り文字を除去し Luhn 合格時のみ redact。
	let result = normalized.replace(CARD_SPACED_PATTERN, (match) => {
		const digits = match.replace(/[\s-]/g, '');
		if (isValidLuhn(digits)) return PII_REDACTION_MARKERS.CARD;
		return match;
	});

	// Step 4: 既存パターン (email / phone / card last4) + IDN (AC2) 適用。
	// IDN は email より先に処理 — IDN domain は email pattern にも match し得るが、
	// `<IDN_REDACTED>` で先に潰しておけば email pattern は機能上問題なく動作する。
	result = result
		.replace(IDN_PATTERN, PII_REDACTION_MARKERS.IDN)
		.replace(EMAIL_PATTERN, PII_REDACTION_MARKERS.EMAIL)
		.replace(CARD_LAST4_PATTERN, PII_REDACTION_MARKERS.CARD)
		.replace(PHONE_PATTERN, PII_REDACTION_MARKERS.PHONE);

	return result;
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
