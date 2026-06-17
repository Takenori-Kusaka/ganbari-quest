// tests/unit/services/pin-reset-otp.test.ts
// #3070: federated PIN reset の email-OTP 署名 cookie stateless 検証ロジック
//
// 検証ポイント (Issue #3070 セキュリティ要件):
//   - 一致で ok / 不一致で attempts+1 再 sign / 試行上限で cookie 失効
//   - 失効 (TTL 超過) は CODE_EXPIRED
//   - 改竄 (署名不正) は INVALID_CODE + cookie clear
//   - テナント跨ぎ (cookie tenantId ≠ session tenantId) は INVALID_CODE (IDOR 防止)
//   - cookie 不在は CODE_REQUIRED
//   - code 平文は cookie に含まれない (ハッシュのみ)

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/runtime/env', () => ({
	getEnv: () => ({ PARENT_GATE_COOKIE_SECRET: 'unit-test-secret-1234567890', NODE_ENV: 'test' }),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { issuePinResetOtp, verifyPinResetOtp, generatePinResetOtpCode, PIN_RESET_OTP_MAX_ATTEMPTS } =
	await import('../../../src/lib/server/services/pin-reset-otp');

const TENANT = 'tenant-abc';

describe('pin-reset-otp (#3070)', () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it('generatePinResetOtpCode は 6 桁ゼロ埋め文字列を返す', () => {
		for (let i = 0; i < 50; i++) {
			const code = generatePinResetOtpCode();
			expect(code).toMatch(/^\d{6}$/);
		}
	});

	it('issue した cookie に code 平文が含まれない (ハッシュのみ保持)', () => {
		const { code, cookieValue } = issuePinResetOtp(TENANT);
		expect(code).toMatch(/^\d{6}$/);
		// cookie に code が平文で現れない (base64 payload を decode しても codeHash のみ)
		expect(cookieValue).not.toContain(code);
		const decoded = Buffer.from(cookieValue.split('.')[0] ?? '', 'base64').toString('utf8');
		expect(decoded).not.toContain(code);
		expect(decoded).toContain('codeHash');
	});

	it('正しい code で ok を返す', () => {
		const { code, cookieValue } = issuePinResetOtp(TENANT);
		expect(verifyPinResetOtp(cookieValue, code, TENANT)).toEqual({ ok: true });
	});

	it('cookie 不在は CODE_REQUIRED (nextCookie null)', () => {
		expect(verifyPinResetOtp(undefined, '123456', TENANT)).toEqual({
			ok: false,
			reason: 'CODE_REQUIRED',
			nextCookie: null,
		});
	});

	it('改竄 cookie (署名不正) は INVALID_CODE + cookie clear', () => {
		const { cookieValue } = issuePinResetOtp(TENANT);
		const tampered = `${cookieValue}x`; // 署名末尾を破壊
		const result = verifyPinResetOtp(tampered, '123456', TENANT);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('INVALID_CODE');
			expect(result.nextCookie).toBeNull();
		}
	});

	it('テナント跨ぎ (cookie ≠ session tenantId) は INVALID_CODE (IDOR 防止)', () => {
		const { code, cookieValue } = issuePinResetOtp(TENANT);
		const result = verifyPinResetOtp(cookieValue, code, 'other-tenant');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('INVALID_CODE');
			expect(result.nextCookie).toBeNull();
		}
	});

	it('不一致は attempts+1 で再 sign (nextCookie)、残試行を継続できる', () => {
		const { cookieValue } = issuePinResetOtp(TENANT);
		const r1 = verifyPinResetOtp(cookieValue, '000000', TENANT);
		expect(r1.ok).toBe(false);
		if (!r1.ok) {
			expect(r1.reason).toBe('INVALID_CODE');
			expect(r1.nextCookie).toBeTruthy();
		}
	});

	it('consume-once: 一致後に同 code を再検証しても、cookie clear 運用で再利用できない (呼び出し側 delete 前提)', () => {
		// verify 自体は冪等 (cookie が残っていれば一致を返す) だが、endpoint が成功時に cookie を
		// delete する設計のため、同 cookie の二度目検証は endpoint レイヤで cookie 不在 = CODE_REQUIRED になる。
		// ここでは verify が一致を 2 回返すこと自体は許容し、consume は endpoint の delete で担保することを記録する。
		const { code, cookieValue } = issuePinResetOtp(TENANT);
		expect(verifyPinResetOtp(cookieValue, code, TENANT).ok).toBe(true);
		// cookie が手元にある限り一致するが、endpoint は成功時に delete 済みなので二度目は cookie undefined
		expect(verifyPinResetOtp(undefined, code, TENANT)).toEqual({
			ok: false,
			reason: 'CODE_REQUIRED',
			nextCookie: null,
		});
	});

	it('試行上限到達で TOO_MANY_ATTEMPTS + cookie 失効 (nextCookie null)', () => {
		let cookie = issuePinResetOtp(TENANT).cookieValue;
		// 不一致を繰り返す。MAX_ATTEMPTS 回目の不一致で上限到達 → TOO_MANY_ATTEMPTS で clear
		for (let attempt = 1; attempt <= PIN_RESET_OTP_MAX_ATTEMPTS; attempt++) {
			const r = verifyPinResetOtp(cookie, '000000', TENANT);
			expect(r.ok).toBe(false);
			if (r.ok) continue;
			if (attempt < PIN_RESET_OTP_MAX_ATTEMPTS) {
				expect(r.reason).toBe('INVALID_CODE');
				expect(r.nextCookie).toBeTruthy();
				cookie = r.nextCookie as string;
			} else {
				// attempts が上限に達する不一致 → clear
				expect(r.reason).toBe('TOO_MANY_ATTEMPTS');
				expect(r.nextCookie).toBeNull();
			}
		}
	});

	it('TTL 超過は CODE_EXPIRED + cookie clear', () => {
		vi.useFakeTimers();
		const { code, cookieValue } = issuePinResetOtp(TENANT);
		// 11 分進める (TTL=10 分)
		vi.advanceTimersByTime(11 * 60 * 1000);
		const result = verifyPinResetOtp(cookieValue, code, TENANT);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('CODE_EXPIRED');
			expect(result.nextCookie).toBeNull();
		}
		vi.useRealTimers();
	});
});
