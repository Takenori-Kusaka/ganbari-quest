/**
 * tests/unit/services/push-endpoint-validation.test.ts (#3188 #3)
 *
 * Web Push subscribe endpoint の SSRF hardening 検証。internal host / 非 https /
 * 偽装ホストを拒否し、主要ブラウザの正規 push endpoint を通すことを固定する。
 */

import { describe, expect, it } from 'vitest';

import {
	isValidPushKey,
	validatePushEndpoint,
} from '../../../src/lib/server/services/push-endpoint-validation';

describe('validatePushEndpoint (#3188 SSRF hardening)', () => {
	it('主要ブラウザの正規 push endpoint を通す', () => {
		const valid = [
			'https://fcm.googleapis.com/fcm/send/abc123',
			'https://fcm.googleapis.com/wp/xyz',
			'https://android.googleapis.com/gcm/send/foo',
			'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
			'https://web.push.apple.com/QABC',
			'https://abc.notify.windows.com/w/?token=xyz',
		];
		for (const ep of valid) {
			expect(validatePushEndpoint(ep)).toEqual({ ok: true, url: ep });
		}
	});

	it('https 以外 (http / file / gopher) を拒否', () => {
		for (const ep of [
			'http://fcm.googleapis.com/fcm/send/abc',
			'file:///etc/passwd',
			'gopher://fcm.googleapis.com/',
		]) {
			expect(validatePushEndpoint(ep).ok).toBe(false);
		}
	});

	it('internal / metadata / private host を拒否 (SSRF 本丸)', () => {
		for (const ep of [
			'https://169.254.169.254/latest/meta-data/',
			'https://localhost/push',
			'https://127.0.0.1:8080/push',
			'https://10.0.0.5/internal',
			'https://192.168.1.1/admin',
		]) {
			expect(validatePushEndpoint(ep).ok).toBe(false);
		}
	});

	it('allowlist ホストを末尾に偽装した host を拒否', () => {
		for (const ep of [
			'https://evil.com/fcm.googleapis.com',
			'https://fcm.googleapis.com.attacker.com/send',
			'https://push.apple.com.evil.net/x',
		]) {
			expect(validatePushEndpoint(ep).ok).toBe(false);
		}
	});

	it('空 / 非文字列 / 不正 URL / 過長を拒否', () => {
		expect(validatePushEndpoint('').ok).toBe(false);
		expect(validatePushEndpoint(undefined).ok).toBe(false);
		expect(validatePushEndpoint(12345).ok).toBe(false);
		expect(validatePushEndpoint('not a url').ok).toBe(false);
		expect(validatePushEndpoint(`https://fcm.googleapis.com/${'a'.repeat(3000)}`).ok).toBe(false);
	});
});

describe('isValidPushKey (#3188)', () => {
	it('base64 / base64url の正規 key を通す', () => {
		expect(isValidPushKey('BNcRdmF-1234_abcXYZ')).toBe(true);
		expect(isValidPushKey('abc+/def==')).toBe(true);
		expect(isValidPushKey('a'.repeat(88))).toBe(true);
	});

	it('空 / 非文字列 / 不正文字 / 過長を拒否', () => {
		expect(isValidPushKey('')).toBe(false);
		expect(isValidPushKey(undefined)).toBe(false);
		expect(isValidPushKey('has space')).toBe(false);
		expect(isValidPushKey('has\nnewline')).toBe(false);
		expect(isValidPushKey('<script>')).toBe(false);
		expect(isValidPushKey('a'.repeat(300))).toBe(false);
		// auth は短いので maxLen=64 を超えると拒否
		expect(isValidPushKey('a'.repeat(80), 64)).toBe(false);
	});
});
