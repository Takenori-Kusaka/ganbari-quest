// tests/unit/domain/subscription-plan-constants.test.ts
// #972 / #2860 PR-L5: SUBSCRIPTION_PLAN 定数 / 派生集合 / ヘルパの網羅性テスト
//
// 目的: 新プラン追加時に必要な派生配列の更新漏れを検出する。
// SUBSCRIPTION_PLAN に値を追加したら planDurationDays に case を足さない限り
// 型エラーになる設計だが、派生配列 (MONTHLY_PLANS 等) は型では検出できないため
// ここで集合関係を明示的に assert する。

import { describe, expect, it } from 'vitest';
import {
	ALL_SUBSCRIPTION_PLANS,
	FAMILY_PLANS,
	isFamilyPlan,
	isLifetimePlan,
	isMonthlyPlan,
	isYearlyPlan,
	MONTHLY_PLANS,
	planDurationDays,
	STANDARD_PLANS,
	SUBSCRIPTION_PLAN,
	type SubscriptionPlan,
	YEARLY_PLANS,
} from '../../../src/lib/domain/constants/subscription-plan';

describe('SUBSCRIPTION_PLAN 定数', () => {
	it('値は既存 DB / Stripe との後方互換性のため kebab-case を維持', () => {
		expect(SUBSCRIPTION_PLAN.MONTHLY).toBe('monthly');
		expect(SUBSCRIPTION_PLAN.YEARLY).toBe('yearly');
		expect(SUBSCRIPTION_PLAN.FAMILY_MONTHLY).toBe('family-monthly');
		expect(SUBSCRIPTION_PLAN.FAMILY_YEARLY).toBe('family-yearly');
		expect(SUBSCRIPTION_PLAN.LIFETIME).toBe('lifetime');
	});

	it('ALL_SUBSCRIPTION_PLANS は全プランを含む (重複なし)', () => {
		expect(ALL_SUBSCRIPTION_PLANS).toHaveLength(5);
		expect(new Set(ALL_SUBSCRIPTION_PLANS).size).toBe(ALL_SUBSCRIPTION_PLANS.length);
	});

	it('ALL_SUBSCRIPTION_PLANS は SUBSCRIPTION_PLAN の全 value と一致する', () => {
		const values = Object.values(SUBSCRIPTION_PLAN).sort();
		const all = [...ALL_SUBSCRIPTION_PLANS].sort();
		expect(all).toEqual(values);
	});
});

describe('派生集合', () => {
	it('MONTHLY_PLANS は monthly + family-monthly', () => {
		expect(MONTHLY_PLANS).toEqual([SUBSCRIPTION_PLAN.MONTHLY, SUBSCRIPTION_PLAN.FAMILY_MONTHLY]);
	});

	it('YEARLY_PLANS は yearly + family-yearly', () => {
		expect(YEARLY_PLANS).toEqual([SUBSCRIPTION_PLAN.YEARLY, SUBSCRIPTION_PLAN.FAMILY_YEARLY]);
	});

	it('FAMILY_PLANS は family-monthly + family-yearly', () => {
		expect(FAMILY_PLANS).toEqual([
			SUBSCRIPTION_PLAN.FAMILY_MONTHLY,
			SUBSCRIPTION_PLAN.FAMILY_YEARLY,
		]);
	});

	it('STANDARD_PLANS は monthly + yearly', () => {
		expect(STANDARD_PLANS).toEqual([SUBSCRIPTION_PLAN.MONTHLY, SUBSCRIPTION_PLAN.YEARLY]);
	});

	it('MONTHLY_PLANS と YEARLY_PLANS は素 (交差なし)', () => {
		const intersection = MONTHLY_PLANS.filter((p) => YEARLY_PLANS.includes(p));
		expect(intersection).toEqual([]);
	});

	it('STANDARD_PLANS と FAMILY_PLANS は素 (交差なし)', () => {
		const intersection = STANDARD_PLANS.filter((p) => FAMILY_PLANS.includes(p));
		expect(intersection).toEqual([]);
	});

	it('全有料プラン (STANDARD + FAMILY) + LIFETIME = ALL_SUBSCRIPTION_PLANS', () => {
		const paidAndLifetime = [...STANDARD_PLANS, ...FAMILY_PLANS, SUBSCRIPTION_PLAN.LIFETIME].sort();
		const all = [...ALL_SUBSCRIPTION_PLANS].sort();
		expect(paidAndLifetime).toEqual(all);
	});
});

describe('ヘルパ関数', () => {
	it('isMonthlyPlan', () => {
		expect(isMonthlyPlan(SUBSCRIPTION_PLAN.MONTHLY)).toBe(true);
		expect(isMonthlyPlan(SUBSCRIPTION_PLAN.FAMILY_MONTHLY)).toBe(true);
		expect(isMonthlyPlan(SUBSCRIPTION_PLAN.YEARLY)).toBe(false);
		expect(isMonthlyPlan(SUBSCRIPTION_PLAN.FAMILY_YEARLY)).toBe(false);
		expect(isMonthlyPlan(SUBSCRIPTION_PLAN.LIFETIME)).toBe(false);
	});

	it('isYearlyPlan', () => {
		expect(isYearlyPlan(SUBSCRIPTION_PLAN.YEARLY)).toBe(true);
		expect(isYearlyPlan(SUBSCRIPTION_PLAN.FAMILY_YEARLY)).toBe(true);
		expect(isYearlyPlan(SUBSCRIPTION_PLAN.MONTHLY)).toBe(false);
	});

	it('isFamilyPlan', () => {
		expect(isFamilyPlan(SUBSCRIPTION_PLAN.FAMILY_MONTHLY)).toBe(true);
		expect(isFamilyPlan(SUBSCRIPTION_PLAN.FAMILY_YEARLY)).toBe(true);
		expect(isFamilyPlan(SUBSCRIPTION_PLAN.MONTHLY)).toBe(false);
		expect(isFamilyPlan(SUBSCRIPTION_PLAN.YEARLY)).toBe(false);
	});

	it('isLifetimePlan', () => {
		expect(isLifetimePlan(SUBSCRIPTION_PLAN.LIFETIME)).toBe(true);
		expect(isLifetimePlan(SUBSCRIPTION_PLAN.MONTHLY)).toBe(false);
	});
});

describe('planDurationDays', () => {
	it('monthly 系は 30 日', () => {
		expect(planDurationDays(SUBSCRIPTION_PLAN.MONTHLY)).toBe(30);
		expect(planDurationDays(SUBSCRIPTION_PLAN.FAMILY_MONTHLY)).toBe(30);
	});

	it('yearly 系は 365 日', () => {
		expect(planDurationDays(SUBSCRIPTION_PLAN.YEARLY)).toBe(365);
		expect(planDurationDays(SUBSCRIPTION_PLAN.FAMILY_YEARLY)).toBe(365);
	});

	it('lifetime は期限なし (undefined)', () => {
		expect(planDurationDays(SUBSCRIPTION_PLAN.LIFETIME)).toBeUndefined();
	});

	it('全プランについて例外を投げずに結果を返す (網羅性)', () => {
		for (const plan of ALL_SUBSCRIPTION_PLANS) {
			expect(() => planDurationDays(plan)).not.toThrow();
		}
	});

	it('未知のプラン値は例外を投げる (ランタイムガード)', () => {
		// 型システムを意図的にバイパスして網羅性ガードの動作を確認
		const unknownPlan = 'unknown-plan' as unknown as SubscriptionPlan;
		expect(() => planDurationDays(unknownPlan)).toThrow(/unknown plan/);
	});
});
