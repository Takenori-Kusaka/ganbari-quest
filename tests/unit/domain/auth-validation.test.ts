import { describe, expect, it } from 'vitest';
import { PIN_LENGTH } from '../../../src/lib/domain/constants/oyakagi';
import {
	isValidPinFormat,
	PIN_LENGTH,
	PIN_PATTERN,
} from '../../../src/lib/domain/constants/oyakagi';
import {
	loginSchema,
	MAX_FAILED_ATTEMPTS,
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

	// #4661: 桁数は「入口 (/switch の PinInput) が実際に打てる 4 桁」に統一した。
	// 5〜6 桁を通していた頃は、その桁数で設定した保護者が /switch から入れなくなっていた。
	it('5桁のPINを拒否する (入口が 4 桁固定のため設定させない)', () => {
		const result = pinSchema.safeParse('12345');
		expect(result.success).toBe(false);
	});

	it('6桁のPINを拒否する (同上)', () => {
		const result = pinSchema.safeParse('123456');
		expect(result.success).toBe(false);
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

describe('isValidPinFormat / PIN_PATTERN (#4698 全 PIN 入口共通の形式判定)', () => {
	it.each(['1234', '0000', '9999'])('%s (PIN_LENGTH 桁の数字) を受け入れる', (pin) => {
		expect(isValidPinFormat(pin)).toBe(true);
		expect(PIN_PATTERN.test(pin)).toBe(true);
	});

	it.each([
		'123',
		'12345',
		'123456',
		'12345678',
		'12ab',
		'',
		' 1234',
		'１２３４',
	])('%j を拒否する', (pin) => {
		expect(isValidPinFormat(pin)).toBe(false);
	});

	it('string 以外 (undefined / number / null) は false (API body の型ゆらぎ)', () => {
		expect(isValidPinFormat(undefined)).toBe(false);
		expect(isValidPinFormat(1234)).toBe(false);
		expect(isValidPinFormat(null)).toBe(false);
	});

	it('PIN_PATTERN は PIN_LENGTH から導出される (定数を変えれば pattern も追随)', () => {
		expect(PIN_PATTERN.source).toBe(`^\\d{${PIN_LENGTH}}$`);
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

// Epic #2525 Phase 7 PR-L5 (#2860): license key 全廃に伴い signupSchema の licenseKey 欄は撤去済。
// entitlement は Stripe Subscription (tenant.status) が唯一 SSOT のため、email + password のみ検証する。
describe('signupSchema', () => {
	const base = { email: 'test@example.com', password: 'Password1' };

	it('email + password のみで受け入れる (licenseKey 欄なし)', () => {
		const result = signupSchema.safeParse(base);
		expect(result.success).toBe(true);
	});

	it('不正な email を拒否する', () => {
		const result = signupSchema.safeParse({ ...base, email: 'not-an-email' });
		expect(result.success).toBe(false);
	});

	it('8 文字未満のパスワードを拒否する', () => {
		const result = signupSchema.safeParse({ ...base, password: 'short' });
		expect(result.success).toBe(false);
	});
});

describe('auth定数', () => {
	// #4661: PIN 長は constants/oyakagi.ts の PIN_LENGTH 単独が SSOT (min/max の 2 値は廃止)。
	it('PIN長が SSOT (PIN_LENGTH) と一致する', () => {
		expect(PIN_LENGTH).toBe(4);
		expect(pinSchema.safeParse('0'.repeat(PIN_LENGTH)).success).toBe(true);
		expect(pinSchema.safeParse('0'.repeat(PIN_LENGTH + 1)).success).toBe(false);
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
