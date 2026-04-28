// tests/unit/services/unsubscribe-token.test.ts
// #1601: 配信停止トークン (HMAC) のユニットテスト

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	generateUnsubscribeToken,
	verifyUnsubscribeToken,
} from '../../../src/lib/server/services/unsubscribe-token';

const ORIGINAL_OPS = process.env.OPS_SECRET_KEY;
const ORIGINAL_AUTH = process.env.AUTH_MODE;

beforeEach(() => {
	process.env.OPS_SECRET_KEY = 'test-secret-key-32bytes-aaaaaaaaaa';
	process.env.AUTH_MODE = 'cognito';
});

afterEach(() => {
	if (ORIGINAL_OPS === undefined) delete process.env.OPS_SECRET_KEY;
	else process.env.OPS_SECRET_KEY = ORIGINAL_OPS;
	if (ORIGINAL_AUTH === undefined) delete process.env.AUTH_MODE;
	else process.env.AUTH_MODE = ORIGINAL_AUTH;
});

describe('#1601 unsubscribe-token — generate', () => {
	it('tenantId と kind を含むトークンを生成する', () => {
		const token = generateUnsubscribeToken({ tenantId: 't-abc', kind: 'marketing' });
		const parts = token.split('.');
		expect(parts).toHaveLength(3);
		expect(parts[0]).toBe('t-abc');
		expect(parts[1]).toBe('marketing');
		expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
	});

	it('kind=system も生成可能', () => {
		const token = generateUnsubscribeToken({ tenantId: 't-1', kind: 'system' });
		expect(token.startsWith('t-1.system.')).toBe(true);
	});

	it('tenantId が空なら例外', () => {
		expect(() => generateUnsubscribeToken({ tenantId: '', kind: 'marketing' })).toThrow(
			/tenantId is required/,
		);
	});

	it('tenantId に "." を含むと delimiter conflict 例外', () => {
		expect(() => generateUnsubscribeToken({ tenantId: 't.malicious', kind: 'marketing' })).toThrow(
			/must not contain/,
		);
	});
});

describe('#1601 unsubscribe-token — verify', () => {
	it('自身が生成したトークンを正しく decode する', () => {
		const token = generateUnsubscribeToken({ tenantId: 't-abc', kind: 'marketing' });
		const payload = verifyUnsubscribeToken(token);
		expect(payload).toEqual({ tenantId: 't-abc', kind: 'marketing' });
	});

	it('改竄されたトークンは null を返す', () => {
		const token = generateUnsubscribeToken({ tenantId: 't-abc', kind: 'marketing' });
		const tampered = `${token.slice(0, -3)}AAA`;
		expect(verifyUnsubscribeToken(tampered)).toBeNull();
	});

	it('別シークレットで作られたトークンは検証失敗', () => {
		const token = generateUnsubscribeToken({ tenantId: 't-abc', kind: 'marketing' });
		process.env.OPS_SECRET_KEY = 'different-secret-key-32bytes-bbbbb';
		expect(verifyUnsubscribeToken(token)).toBeNull();
	});

	it('空文字 / null は null を返す', () => {
		expect(verifyUnsubscribeToken('')).toBeNull();
		expect(verifyUnsubscribeToken('not-a-token')).toBeNull();
	});

	it('未知の kind は受け付けない', () => {
		// 手動で改竄
		const token = generateUnsubscribeToken({ tenantId: 't-1', kind: 'marketing' });
		const parts = token.split('.');
		const fakeToken = `${parts[0]}.evil.${parts[2]}`;
		expect(verifyUnsubscribeToken(fakeToken)).toBeNull();
	});

	it('parts 数が 3 でないトークンは null', () => {
		expect(verifyUnsubscribeToken('a.b')).toBeNull();
		expect(verifyUnsubscribeToken('a.b.c.d')).toBeNull();
	});

	it('tenantId 部が空のトークンは null', () => {
		// .marketing.<sig>
		expect(verifyUnsubscribeToken('.marketing.signature')).toBeNull();
	});
});

describe('#1601 unsubscribe-token — local fallback', () => {
	it('AUTH_MODE=local かつ secret 未設定でもトークン生成 / 検証できる', () => {
		delete process.env.OPS_SECRET_KEY;
		process.env.AUTH_MODE = 'local';
		const token = generateUnsubscribeToken({ tenantId: 't-1', kind: 'marketing' });
		const payload = verifyUnsubscribeToken(token);
		expect(payload).toEqual({ tenantId: 't-1', kind: 'marketing' });
	});

	it('AUTH_MODE!=local かつ secret 未設定なら例外', () => {
		delete process.env.OPS_SECRET_KEY;
		delete process.env.CRON_SECRET;
		process.env.AUTH_MODE = 'cognito';
		expect(() => generateUnsubscribeToken({ tenantId: 't-1', kind: 'marketing' })).toThrow(
			/required in non-local environments/,
		);
	});
});
