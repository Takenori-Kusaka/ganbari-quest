import { describe, expect, it } from 'vitest';
import {
	loginSchema,
	MAX_FAILED_ATTEMPTS,
	PIN_MAX_LENGTH,
	PIN_MIN_LENGTH,
	pinSchema,
	SESSION_COOKIE_NAME,
	SESSION_MAX_AGE_SECONDS,
	signupSchema,
} from '../../../src/lib/domain/validation/auth';

describe('pinSchema', () => {
	it('4桁のPINを受け入れる', () => {
		const result = pinSchema.safeParse('1234');
		expect(result.success).toBe(true);
	});

	it('5桁のPINを受け入れる', () => {
		const result = pinSchema.safeParse('12345');
		expect(result.success).toBe(true);
	});

	it('6桁のPINを受け入れる', () => {
		const result = pinSchema.safeParse('123456');
		expect(result.success).toBe(true);
	});

	it('3桁のPINを拒否する', () => {
		const result = pinSchema.safeParse('123');
		expect(result.success).toBe(false);
	});

	it('7桁のPINを拒否する', () => {
		const result = pinSchema.safeParse('1234567');
		expect(result.success).toBe(false);
	});

	it('英字を含むPINを拒否する', () => {
		const result = pinSchema.safeParse('12ab');
		expect(result.success).toBe(false);
	});

	it('空文字を拒否する', () => {
		const result = pinSchema.safeParse('');
		expect(result.success).toBe(false);
	});

	it('数字以外の記号を拒否する', () => {
		const result = pinSchema.safeParse('12-3');
		expect(result.success).toBe(false);
	});
});

describe('loginSchema', () => {
	it('有効なオブジェクト形式を受け入れる', () => {
		const result = loginSchema.safeParse({ pin: '1234' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.pin).toBe('1234');
		}
	});

	it('pinフィールドがないオブジェクトを拒否する', () => {
		const result = loginSchema.safeParse({ password: '1234' });
		expect(result.success).toBe(false);
	});

	it('不正なpin値のオブジェクトを拒否する', () => {
		const result = loginSchema.safeParse({ pin: '12' });
		expect(result.success).toBe(false);
	});
});

describe('signupSchema — licenseKey', () => {
	const base = { email: 'test@example.com', password: 'Password1' };

	it('空文字のライセンスキーを受け入れる', () => {
		const result = signupSchema.safeParse({ ...base, licenseKey: '' });
		expect(result.success).toBe(true);
	});

	it('旧形式（3グループ）のライセンスキーを受け入れる', () => {
		const result = signupSchema.safeParse({ ...base, licenseKey: 'GQ-ABCD-EFGH-JKLM' });
		expect(result.success).toBe(true);
	});

	it('署名付き形式（4グループ）のライセンスキーを受け入れる', () => {
		const result = signupSchema.safeParse({ ...base, licenseKey: 'GQ-ABCD-EFGH-JKLM-NPRST' });
		expect(result.success).toBe(true);
	});

	it('不正なプレフィックスを拒否する', () => {
		const result = signupSchema.safeParse({ ...base, licenseKey: 'XX-ABCD-EFGH-JKLM' });
		expect(result.success).toBe(false);
	});

	it('セグメント不足を拒否する', () => {
		const result = signupSchema.safeParse({ ...base, licenseKey: 'GQ-ABCD-EFGH' });
		expect(result.success).toBe(false);
	});

	it('チェックサム長が不正な場合を拒否する', () => {
		const result = signupSchema.safeParse({ ...base, licenseKey: 'GQ-ABCD-EFGH-JKLM-NP' });
		expect(result.success).toBe(false);
	});

	it('特殊文字を含むキーを拒否する', () => {
		const result = signupSchema.safeParse({ ...base, licenseKey: 'GQ-AB!D-EFGH-JKLM' });
		expect(result.success).toBe(false);
	});
});

describe('auth定数', () => {
	it('PIN長の範囲が正しい', () => {
		expect(PIN_MIN_LENGTH).toBe(4);
		expect(PIN_MAX_LENGTH).toBe(6);
	});

	it('最大失敗回数が5回', () => {
		expect(MAX_FAILED_ATTEMPTS).toBe(5);
	});

	it('セッション有効期間が1年', () => {
		expect(SESSION_MAX_AGE_SECONDS).toBe(365 * 24 * 60 * 60);
	});

	it('Cookie名が定義されている', () => {
		expect(SESSION_COOKIE_NAME).toBe('sessionToken');
	});
});
