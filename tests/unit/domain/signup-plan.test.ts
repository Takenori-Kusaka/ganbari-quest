// tests/unit/domain/signup-plan.test.ts
// #4501: `?plan=` の値域 SSOT (parseSignupPlanParam)。
// #4702: 上記 SSOT をメール登録経路 (signup ?/confirm) と Google 登録経路
// (/auth/oauth/google → cookie → /auth/oauth/trial-start) で同一にするための OAuth cookie 契約。
import { describe, expect, it } from 'vitest';
import {
	OAUTH_PLAN_COOKIE_NAME,
	OAUTH_PLAN_MAX_AGE_SECONDS,
	parseSignupPlanParam,
	SIGNUP_PLAN_PARAMS,
} from '../../../src/lib/domain/validation/signup-plan';

describe('parseSignupPlanParam (#4501 / #4702 SSOT)', () => {
	it('standard はそのまま standard', () => {
		expect(parseSignupPlanParam('standard')).toBe('standard');
	});

	it('premium はそのまま premium', () => {
		expect(parseSignupPlanParam('premium')).toBe('premium');
	});

	it("旧 alias 'family' は premium に正規化する (ブックマーク / 既存 LP リンク救済)", () => {
		expect(parseSignupPlanParam('family')).toBe('premium');
	});

	it('大文字 / 前後空白は正規化する', () => {
		expect(parseSignupPlanParam(' Standard ')).toBe('standard');
		expect(parseSignupPlanParam('FAMILY')).toBe('premium');
		expect(parseSignupPlanParam('Premium')).toBe('premium');
	});

	it.each([
		'free',
		'',
		' ',
		'standard;family',
		'standard-x',
		null,
		undefined,
	])('%j は null (プラン指定なし)', (v) => {
		expect(parseSignupPlanParam(v as string | null | undefined)).toBeNull();
	});

	it('cookie 契約: 名前は oauth_plan、寿命は oauth_next と同じ 10 分', () => {
		expect(OAUTH_PLAN_COOKIE_NAME).toBe('oauth_plan');
		expect(OAUTH_PLAN_MAX_AGE_SECONDS).toBe(600);
	});

	it('受理する外部入力の値域 (旧 alias family を含む)', () => {
		expect([...SIGNUP_PLAN_PARAMS]).toEqual(['standard', 'premium', 'family']);
	});
});
