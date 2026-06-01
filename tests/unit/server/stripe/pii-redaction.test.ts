// tests/unit/server/stripe/pii-redaction.test.ts
//
// Issue #2738: PII redaction util の動作検証 (QA Adversarial security 軸 BLOCK V-3 解消)。
//
// 検証内容:
//   - email / phone / card last4 / card full の各パターンが redact される (false negative 検証)
//   - Stripe 内部 ID (cus_* / sub_* 等) は redact されず維持される
//   - 正常 errMsg (PII 含まず) で意図しない redaction が発生しない (false positive 検証)
//   - structured tags の string value のみ redact、数値 / boolean は維持
//   - performance < 1ms / call (alert path 非ブロッキング要件)
//
// 設計 SSOT:
//   - src/lib/server/stripe/pii-redaction.ts
//   - docs/design/billing-redesign/phase6-rollback-and-kill-switches.md §5 alert SSOT

import { describe, expect, it } from 'vitest';
import {
	PII_REDACTION_MARKERS,
	redactPii,
	redactPiiInTags,
} from '$lib/server/stripe/pii-redaction';

describe('redactPii — email redaction (#2738 false negative 検証)', () => {
	it.each([
		['foo@example.com'],
		['john.doe+tag@sub.example.co.jp'],
		['user_123@example-domain.com'],
		['a@b.io'],
	])('email %s を redact する', (email) => {
		const input = `customer email: ${email} で課金失敗`;
		const output = redactPii(input);
		expect(output).not.toContain(email);
		expect(output).toContain(PII_REDACTION_MARKERS.EMAIL);
	});

	it('複数 email を全件 redact する', () => {
		const input = 'from foo@example.com to bar@test.co.jp';
		const output = redactPii(input);
		expect(output).not.toContain('foo@example.com');
		expect(output).not.toContain('bar@test.co.jp');
		const emailCount = (output.match(/<EMAIL_REDACTED>/g) ?? []).length;
		expect(emailCount).toBe(2);
	});
});

describe('redactPii — card redaction (#2738 false negative 検証)', () => {
	it.each([
		['card ending in 4242'],
		['last4: 4242'],
		['last4 4242'],
		['****4242'],
		['**** 4242'],
	])('card last4 pattern %s を redact する', (pattern) => {
		const output = redactPii(`Payment failed: ${pattern}`);
		expect(output).toContain(PII_REDACTION_MARKERS.CARD);
		expect(output).not.toMatch(/\b4242\b/);
	});

	it('card full number (13-19 桁) を redact する', () => {
		const output = redactPii('Card number 4242424242424242 was declined');
		expect(output).not.toContain('4242424242424242');
		expect(output).toContain(PII_REDACTION_MARKERS.CARD);
	});
});

describe('redactPii — phone redaction (#2738 false negative 検証)', () => {
	it.each([
		['+81-90-1234-5678'],
		['+1 415 555 0100'],
		['090-1234-5678'],
		['+819012345678'],
	])('phone %s を redact する', (phone) => {
		const output = redactPii(`Customer phone: ${phone} で連絡不可`);
		// phone が原形で残存していないこと
		expect(output.includes(phone)).toBe(false);
		expect(output).toContain(PII_REDACTION_MARKERS.PHONE);
	});
});

describe('redactPii — Stripe 内部 ID 維持 (#2738 false positive 防止)', () => {
	it.each([
		['cus_NyP8b3FwsqLpBJ'],
		['sub_1MowQVLkdIwHu7ix'],
		['price_1MoBy5LkdIwHu7ixZhnattbH'],
		['pi_3NfQVxLkdIwHu7ix0p0jGZcr'],
		['ch_3MtwBwLkdIwHu7ix1zN5DHwT'],
		['evt_1NfQVxLkdIwHu7ix'],
	])('Stripe ID %s は redact されない (debug 維持)', (stripeId) => {
		// 結果に Stripe ID が含まれる
		expect(redactPiiInTags({ id: stripeId })?.id).toBe(stripeId);
	});
});

describe('redactPii — false positive 防止 (正常 errMsg)', () => {
	it('PII を含まない正常な errMsg は変化しない', () => {
		const input = 'lookup_failed:standard_monthly (kill switch fallback 起動)';
		expect(redactPii(input)).toBe(input);
	});

	it('Stripe error code は redact されない', () => {
		const input = 'StripeInvalidRequestError: No such price';
		expect(redactPii(input)).toBe(input);
	});

	it('plan / interval 文字列は redact されない', () => {
		const input = 'plan=premium interval=monthly fallback=true';
		expect(redactPii(input)).toBe(input);
	});

	it.each([[''], [undefined], [null]])('空入力 %s は空文字を返す', (input) => {
		expect(redactPii(input as string | undefined | null)).toBe('');
	});
});

describe('redactPiiInTags — structured tags shape 維持', () => {
	it('数値 / boolean は維持される (redact 対象外)', () => {
		const result = redactPiiInTags({ count: 5, success: true });
		expect(result).toEqual({ count: 5, success: true });
	});

	it('string value の PII のみ redact、Stripe ID は維持', () => {
		const result = redactPiiInTags({
			email: 'user@example.com',
			customerId: 'cus_NyP8b3FwsqLpBJ',
			plan: 'premium',
		});
		expect(result?.email).toBe(PII_REDACTION_MARKERS.EMAIL);
		expect(result?.customerId).toBe('cus_NyP8b3FwsqLpBJ');
		expect(result?.plan).toBe('premium');
	});

	it('tags 未指定時は undefined を返す', () => {
		expect(redactPiiInTags(undefined)).toBeUndefined();
	});
});

describe('redactPii — performance (#2738 alert path 非ブロッキング要件)', () => {
	it('1000 回連続呼出が 100ms 未満 (1 回あたり < 0.1ms)', () => {
		const input =
			'Customer email foo@example.com phone +81-90-1234-5678 card ending in 4242 failed for cus_NyP8b3FwsqLpBJ';
		const start = performance.now();
		for (let i = 0; i < 1000; i++) {
			redactPii(input);
		}
		const elapsedMs = performance.now() - start;
		expect(elapsedMs).toBeLessThan(100);
	});
});

describe('redactPii — 複合パターン (#2738 本番 errMsg 想定)', () => {
	it('Stripe error 1 行に email + phone + card + Stripe ID 全件混在を redact', () => {
		const input =
			'Stripe error for cus_NyP8b3FwsqLpBJ: customer email foo@example.com phone +81-90-1234-5678 card ending in 4242 declined';
		const output = redactPii(input);
		// PII は全件 redact
		expect(output).not.toContain('foo@example.com');
		expect(output).not.toContain('4242');
		expect(output).not.toContain('90-1234-5678');
		// Stripe ID は維持 (debug)
		expect(output).toContain('cus_NyP8b3FwsqLpBJ');
	});
});
