// tests/unit/services/survey-token.test.ts
// #1598: PMF 判定アンケートトークン (HMAC) のユニットテスト

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvForTesting } from '../../../src/lib/runtime/env';
import {
	generateSurveyToken,
	verifySurveyToken,
} from '../../../src/lib/server/services/survey-token';

const ORIGINAL_OPS = process.env.OPS_SECRET_KEY;
const ORIGINAL_AUTH = process.env.AUTH_MODE;

beforeEach(() => {
	process.env.OPS_SECRET_KEY = 'test-secret-key-32bytes-aaaaaaaaaa';
	process.env.AUTH_MODE = 'cognito';
	resetEnvForTesting();
});

afterEach(() => {
	if (ORIGINAL_OPS === undefined) delete process.env.OPS_SECRET_KEY;
	else process.env.OPS_SECRET_KEY = ORIGINAL_OPS;
	if (ORIGINAL_AUTH === undefined) delete process.env.AUTH_MODE;
	else process.env.AUTH_MODE = ORIGINAL_AUTH;
	resetEnvForTesting();
});

describe('#1598 survey-token — generate', () => {
	it('tenantId と round を含むトークンを生成する', () => {
		const token = generateSurveyToken({ tenantId: 't-abc', round: '2026-H1' });
		const parts = token.split('.');
		expect(parts).toHaveLength(3);
		expect(parts[0]).toBe('t-abc');
		expect(parts[1]).toBe('2026-H1');
		expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
	});

	it('tenantId が空なら例外', () => {
		expect(() => generateSurveyToken({ tenantId: '', round: '2026-H1' })).toThrow(
			/tenantId is required/,
		);
	});

	it('round が空なら例外', () => {
		expect(() => generateSurveyToken({ tenantId: 't-1', round: '' })).toThrow(/round is required/);
	});

	it('tenantId に "." を含むと delimiter conflict 例外', () => {
		expect(() => generateSurveyToken({ tenantId: 't.malicious', round: '2026-H1' })).toThrow(
			/must not contain/,
		);
	});

	it('round に "." を含むと delimiter conflict 例外', () => {
		expect(() => generateSurveyToken({ tenantId: 't-1', round: '2026.H1' })).toThrow(
			/must not contain/,
		);
	});
});

describe('#1598 survey-token — verify', () => {
	it('自身が生成したトークンを正しく decode する', () => {
		const token = generateSurveyToken({ tenantId: 't-abc', round: '2026-H1' });
		const payload = verifySurveyToken(token);
		expect(payload).toEqual({ tenantId: 't-abc', round: '2026-H1' });
	});

	it('改竄されたトークンは null を返す', () => {
		const token = generateSurveyToken({ tenantId: 't-abc', round: '2026-H1' });
		const tampered = `${token.slice(0, -3)}AAA`;
		expect(verifySurveyToken(tampered)).toBeNull();
	});

	it('別シークレットで作られたトークンは検証失敗', () => {
		const token = generateSurveyToken({ tenantId: 't-abc', round: '2026-H1' });
		process.env.OPS_SECRET_KEY = 'different-secret-key-32bytes-bbbbb';
		resetEnvForTesting();
		expect(verifySurveyToken(token)).toBeNull();
	});

	it('空文字 / 不正フォーマットは null を返す', () => {
		expect(verifySurveyToken('')).toBeNull();
		expect(verifySurveyToken('not-a-token')).toBeNull();
		expect(verifySurveyToken('a.b')).toBeNull();
		expect(verifySurveyToken('a.b.c.d')).toBeNull();
	});
});

describe('#1598 survey-token — local fallback', () => {
	it('AUTH_MODE=local かつ secret 未設定でもトークン生成 / 検証できる', () => {
		delete process.env.OPS_SECRET_KEY;
		process.env.AUTH_MODE = 'local';
		resetEnvForTesting();
		const token = generateSurveyToken({ tenantId: 't-1', round: '2026-H1' });
		const payload = verifySurveyToken(token);
		expect(payload).toEqual({ tenantId: 't-1', round: '2026-H1' });
	});

	it('AUTH_MODE!=local かつ secret 未設定なら例外', () => {
		delete process.env.OPS_SECRET_KEY;
		delete process.env.CRON_SECRET;
		process.env.AUTH_MODE = 'cognito';
		resetEnvForTesting();
		expect(() => generateSurveyToken({ tenantId: 't-1', round: '2026-H1' })).toThrow(
			/required in non-local environments/,
		);
	});
});
