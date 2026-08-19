// tests/unit/domain/signup-plan.test.ts
// #4702: `?plan=` の解釈をメール登録経路 (signup ?/confirm) と Google 登録経路
// (/auth/oauth/google → cookie → /auth/oauth/trial-start) で同一にする SSOT の値域テスト。
import { describe, expect, it } from 'vitest';
import {
	OAUTH_PLAN_COOKIE_NAME,
	OAUTH_PLAN_MAX_AGE_SECONDS,
	parsePlanForTrial,
	TRIAL_PLAN_VALUES,
} from '../../../src/lib/domain/validation/signup-plan';

describe('parsePlanForTrial (#4702 SSOT)', () => {
	it.each(TRIAL_PLAN_VALUES)('%s は有効', (plan) => {
		expect(parsePlanForTrial(plan)).toBe(plan);
	});

	it('大文字 / 前後空白は正規化する', () => {
		expect(parsePlanForTrial(' Standard ')).toBe('standard');
		expect(parsePlanForTrial('FAMILY')).toBe('family');
	});

	it.each([
		'free',
		'premium',
		'',
		' ',
		'standard;family',
		'standard-x',
		null,
		undefined,
	])('%j は null (トライアル開始しない)', (v) => {
		expect(parsePlanForTrial(v as string | null | undefined)).toBeNull();
	});

	it('cookie 契約: 名前は oauth_plan、寿命は oauth_next と同じ 10 分', () => {
		expect(OAUTH_PLAN_COOKIE_NAME).toBe('oauth_plan');
		expect(OAUTH_PLAN_MAX_AGE_SECONDS).toBe(600);
	});

	it('値域は trial-service の TrialTier と同じ 2 種のみ (無闇に広げない)', () => {
		expect([...TRIAL_PLAN_VALUES]).toEqual(['standard', 'family']);
	});
});
