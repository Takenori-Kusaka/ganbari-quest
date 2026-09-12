// tests/unit/server/logger-context-redaction.test.ts
// #4947: #4918 で `entry.context` が console (Lambda では CloudWatch への唯一の到達経路) に
// 出るようになった結果、それまで本番のどこにも到達していなかった値が一斉に露出した。
// 実測で「おやカギコードの char code 列 (平文と可逆)」と「保護者メール平文」が含まれていた。
//
// 本 test は出口 1 箇所 (formatMetaSuffix / formatEntry) の redaction を固定する。
// 呼び出し側は 600 箇所以上あり個別修正では次の 1 箇所で破れるため、
// 「呼び出し側が機微値を渡しても出口で落ちる」ことを assert する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/lib/server/logger';

describe('#4947 logger の context redaction', () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it('おやカギコード由来の key (pin 系) は値ごと [redacted] になる', () => {
		logger.warn('[AUTH] おやカギコード再確認失敗', {
			context: {
				pinLen: 4,
				pinCharCodes: '53,48,56,54',
				defaultPinCharCodes: '48,48,48,48',
				tenantIdPrefix: 't-abc',
			},
		});

		const output = String(warnSpy.mock.calls[0][0]);
		// 平文 PIN と可逆な char code 列が出ないこと
		expect(output).not.toContain('53,48,56,54');
		expect(output).not.toContain('48,48,48,48');
		expect(output).toContain('[redacted]');
		// 機微でない値は落とさない (観測性を殺さない)
		expect(output).toContain('t-abc');
	});

	it('token / password / secret / cookie / authorization / otp も落ちる', () => {
		logger.error('boom', {
			context: {
				accessToken: 'eyJhbGciOi',
				password: 'p@ssw0rd',
				clientSecret: 'sk_live_1',
				cookie: 'session=abc',
				authorization: 'Bearer xyz',
				otpCode: '123456',
				apiKey: 'ak_1',
			},
		});

		const output = String(errorSpy.mock.calls[0][0]);
		for (const leaked of ['eyJhbGciOi', 'p@ssw0rd', 'sk_live_1', 'session=abc', 'Bearer xyz', '123456', 'ak_1']) {
			expect(output).not.toContain(leaked);
		}
	});

	it('メールアドレスはマスクされる (ドメインは運用のため残す)', () => {
		logger.warn('[AUTH] ログイン失敗', {
			context: { email: 'parent@example.com', failedCount: 3 },
		});

		const output = String(warnSpy.mock.calls[0][0]);
		expect(output).not.toContain('parent@example.com');
		expect(output).toContain('p***@example.com');
		expect(output).toContain('3');
	});

	it('メール送信の to / subject 経路もマスクされる', () => {
		logger.error('メール送信失敗', {
			context: { to: 'guardian@example.jp', subject: '週次レポート' },
		});

		const output = String(errorSpy.mock.calls[0][0]);
		expect(output).not.toContain('guardian@example.jp');
		expect(output).toContain('g***@example.jp');
	});

	it('ネストした object / 配列の中の機微 key も落ちる', () => {
		logger.error('nested', {
			context: { user: { email: 'a@b.com', profile: { pinCharCodes: '49,50' } }, list: [{ token: 't1' }] },
		});

		const output = String(errorSpy.mock.calls[0][0]);
		expect(output).not.toContain('a@b.com');
		expect(output).not.toContain('49,50');
		expect(output).not.toContain('t1');
	});

	it('機微でない context は #4918 の意図どおりそのまま出る (観測性の非回帰)', () => {
		logger.error('[AUTH] auth-entitlement-db-unavailable', {
			error: 'connection terminated unexpectedly',
			context: { kind: 'auth-entitlement-db-unavailable', tenantId: 't-1' },
		});

		const output = String(errorSpy.mock.calls[0][0]);
		expect(output).toContain('connection terminated unexpectedly');
		expect(output).toContain('auth-entitlement-db-unavailable');
		expect(output).toContain('t-1');
	});
});
