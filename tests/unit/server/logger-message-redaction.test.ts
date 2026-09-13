// tests/unit/server/logger-message-redaction.test.ts
// #4947 恒久策 (PO 判断 2026-09-12): 出口の **値ベース** redaction を固定する。
//
// logger-context-redaction.test.ts は context の key 名で落ちることを見る。本 test は
// 「message に直接埋め込まれた PII」「key 名が想定外の context」「stack」のように
// key 名検査を通らない経路でも、console へ渡る最後の 1 本の文字列で伏せられることを見る。
// 同時に「伏せすぎて観測性を殺していない」ことも固定する (年 / status code / tenantId は残る)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/lib/server/logger';

describe('#4947 logger の値ベース redaction (message / stack / 想定外 key)', () => {
	let infoSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		infoSpy.mockRestore();
		errorSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it('message に直接埋め込まれたメールアドレスは出口でマスクされる (#4947 BLOCK の実例)', () => {
		logger.warn('Feedback received: [その他] inq-1 from parent@example.com (t-abc)');
		const output = String(warnSpy.mock.calls[0][0]);
		expect(output).not.toContain('parent@example.com');
		expect(output).toContain('p***@example.com');
		expect(output).toContain('t-abc');
	});

	it('key 名が想定外 (contact / addr) の context に入ったメールアドレスも値で拾う', () => {
		logger.error('mail failed', {
			context: { contact: 'guardian@example.jp', addr: 'x.y+z@sub.example.co.jp' },
		});
		const output = String(errorSpy.mock.calls[0][0]);
		expect(output).not.toContain('guardian@example.jp');
		expect(output).not.toContain('x.y+z@sub.example.co.jp');
		expect(output).toContain('g***@example.jp');
		expect(output).toContain('x***@sub.example.co.jp');
	});

	it('おやカギコード / PIN / OTP の語の近傍にある 4〜6 桁は伏せる', () => {
		logger.warn('[AUTH] おやカギコード 5086 が一致しません pin=1234 otp: 123456');
		const output = String(warnSpy.mock.calls[0][0]);
		expect(output).not.toContain('5086');
		expect(output).not.toContain('1234');
		expect(output).not.toContain('123456');
		expect(output).toContain('[pin]');
	});

	it('char code 列 (可逆表現) は message に出ても伏せる', () => {
		logger.warn('debug pin chars 53,48,56,54 vs 48,48,48,48');
		const output = String(warnSpy.mock.calls[0][0]);
		expect(output).not.toContain('53,48,56,54');
		expect(output).not.toContain('48,48,48,48');
		expect(output).toContain('[redacted]');
	});

	it('stack trace に含まれるメールアドレスも伏せる', () => {
		logger.error('boom', {
			stack: 'Error: boom\n    at send (mailer.ts:10) to=parent@example.com',
		});
		const stackLine = String(errorSpy.mock.calls[1]?.[0] ?? '');
		expect(stackLine).not.toContain('parent@example.com');
		expect(stackLine).toContain('p***@example.com');
	});

	it('伏せすぎない: 年 / status code / 裸の 4 桁 / tenantId / requestId は残る (観測性の非回帰)', () => {
		logger.warn('Legacy URL redirect: /old → /new (#4048) since 2026 status 404 count 1234', {
			tenantId: 't-1',
			requestId: 'req-9',
			context: { kind: 'auth-entitlement-db-unavailable', failedCount: 3 },
		});
		const output = String(warnSpy.mock.calls[0][0]);
		for (const kept of [
			'2026',
			'404',
			'1234',
			'#4048',
			't-1',
			'req-9',
			'auth-entitlement-db-unavailable',
		]) {
			expect(output).toContain(kept);
		}
		expect(output).not.toContain('[pin]');
		expect(output).not.toContain('[redacted]');
	});

	it('既に key 名でマスク済みの値を二重に壊さない (冪等)', () => {
		logger.warn('login', { context: { email: 'parent@example.com' } });
		const output = String(warnSpy.mock.calls[0][0]);
		expect(output).toContain('p***@example.com');
		expect(output).not.toContain('***@***');
	});
});
