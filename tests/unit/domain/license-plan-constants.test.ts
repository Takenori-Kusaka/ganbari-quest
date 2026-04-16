// tests/unit/domain/license-plan-constants.test.ts
// #972: LICENSE_PLAN 定数 / 派生集合 / ヘルパの網羅性テスト
//
// 目的: 新プラン追加時に必要な派生配列の更新漏れを検出する。
// LICENSE_PLAN に値を追加したら planDurationDays に case を足さない限り
// 型エラーになる設計だが、派生配列 (MONTHLY_PLANS 等) は型では検出できないため
// ここで集合関係を明示的に assert する。

import { describe, expect, it } from 'vitest';
import {
	ALL_LICENSE_PLANS,
	FAMILY_PLANS,
	isFamilyPlan,
	isLifetimePlan,
	isMonthlyPlan,
	isYearlyPlan,
	LICENSE_PLAN,
	type LicensePlan,
	MONTHLY_PLANS,
	planDurationDays,
	STANDARD_PLANS,
	YEARLY_PLANS,
} from '../../../src/lib/domain/constants/license-plan';

describe('LICENSE_PLAN 定数', () => {
	it('値は既存 DB / Stripe との後方互換性のため kebab-case を維持', () => {
		expect(LICENSE_PLAN.MONTHLY).toBe('monthly');
		expect(LICENSE_PLAN.YEARLY).toBe('yearly');
		expect(LICENSE_PLAN.FAMILY_MONTHLY).toBe('family-monthly');
		expect(LICENSE_PLAN.FAMILY_YEARLY).toBe('family-yearly');
		expect(LICENSE_PLAN.LIFETIME).toBe('lifetime');
	});

	it('ALL_LICENSE_PLANS は全プランを含む (重複なし)', () => {
		expect(ALL_LICENSE_PLANS).toHaveLength(5);
		expect(new Set(ALL_LICENSE_PLANS).size).toBe(ALL_LICENSE_PLANS.length);
	});

	it('ALL_LICENSE_PLANS は LICENSE_PLAN の全 value と一致する', () => {
		const values = Object.values(LICENSE_PLAN).sort();
		const all = [...ALL_LICENSE_PLANS].sort();
		expect(all).toEqual(values);
	});
});

describe('派生集合', () => {
	it('MONTHLY_PLANS は monthly + family-monthly', () => {
		expect(MONTHLY_PLANS).toEqual([LICENSE_PLAN.MONTHLY, LICENSE_PLAN.FAMILY_MONTHLY]);
	});

	it('YEARLY_PLANS は yearly + family-yearly', () => {
		expect(YEARLY_PLANS).toEqual([LICENSE_PLAN.YEARLY, LICENSE_PLAN.FAMILY_YEARLY]);
	});

	it('FAMILY_PLANS は family-monthly + family-yearly', () => {
		expect(FAMILY_PLANS).toEqual([LICENSE_PLAN.FAMILY_MONTHLY, LICENSE_PLAN.FAMILY_YEARLY]);
	});

	it('STANDARD_PLANS は monthly + yearly', () => {
		expect(STANDARD_PLANS).toEqual([LICENSE_PLAN.MONTHLY, LICENSE_PLAN.YEARLY]);
	});

	it('MONTHLY_PLANS と YEARLY_PLANS は素 (交差なし)', () => {
		const intersection = MONTHLY_PLANS.filter((p) => YEARLY_PLANS.includes(p));
		expect(intersection).toEqual([]);
	});

	it('STANDARD_PLANS と FAMILY_PLANS は素 (交差なし)', () => {
		const intersection = STANDARD_PLANS.filter((p) => FAMILY_PLANS.includes(p));
		expect(intersection).toEqual([]);
	});

	it('全有料プラン (STANDARD + FAMILY) + LIFETIME = ALL_LICENSE_PLANS', () => {
		const paidAndLifetime = [...STANDARD_PLANS, ...FAMILY_PLANS, LICENSE_PLAN.LIFETIME].sort();
		const all = [...ALL_LICENSE_PLANS].sort();
		expect(paidAndLifetime).toEqual(all);
	});
});

describe('ヘルパ関数', () => {
	it('isMonthlyPlan', () => {
		expect(isMonthlyPlan(LICENSE_PLAN.MONTHLY)).toBe(true);
		expect(isMonthlyPlan(LICENSE_PLAN.FAMILY_MONTHLY)).toBe(true);
		expect(isMonthlyPlan(LICENSE_PLAN.YEARLY)).toBe(false);
		expect(isMonthlyPlan(LICENSE_PLAN.FAMILY_YEARLY)).toBe(false);
		expect(isMonthlyPlan(LICENSE_PLAN.LIFETIME)).toBe(false);
	});

	it('isYearlyPlan', () => {
		expect(isYearlyPlan(LICENSE_PLAN.YEARLY)).toBe(true);
		expect(isYearlyPlan(LICENSE_PLAN.FAMILY_YEARLY)).toBe(true);
		expect(isYearlyPlan(LICENSE_PLAN.MONTHLY)).toBe(false);
	});

	it('isFamilyPlan', () => {
		expect(isFamilyPlan(LICENSE_PLAN.FAMILY_MONTHLY)).toBe(true);
		expect(isFamilyPlan(LICENSE_PLAN.FAMILY_YEARLY)).toBe(true);
		expect(isFamilyPlan(LICENSE_PLAN.MONTHLY)).toBe(false);
		expect(isFamilyPlan(LICENSE_PLAN.YEARLY)).toBe(false);
	});

	it('isLifetimePlan', () => {
		expect(isLifetimePlan(LICENSE_PLAN.LIFETIME)).toBe(true);
		expect(isLifetimePlan(LICENSE_PLAN.MONTHLY)).toBe(false);
	});
});

describe('planDurationDays', () => {
	it('monthly 系は 30 日', () => {
		expect(planDurationDays(LICENSE_PLAN.MONTHLY)).toBe(30);
		expect(planDurationDays(LICENSE_PLAN.FAMILY_MONTHLY)).toBe(30);
	});

	it('yearly 系は 365 日', () => {
		expect(planDurationDays(LICENSE_PLAN.YEARLY)).toBe(365);
		expect(planDurationDays(LICENSE_PLAN.FAMILY_YEARLY)).toBe(365);
	});

	it('lifetime は期限なし (undefined)', () => {
		expect(planDurationDays(LICENSE_PLAN.LIFETIME)).toBeUndefined();
	});

	it('全プランについて例外を投げずに結果を返す (網羅性)', () => {
		for (const plan of ALL_LICENSE_PLANS) {
			expect(() => planDurationDays(plan)).not.toThrow();
		}
	});

	it('未知のプラン値は例外を投げる (ランタイムガード)', () => {
		// 型システムを意図的にバイパスして網羅性ガードの動作を確認
		const unknownPlan = 'unknown-plan' as unknown as LicensePlan;
		expect(() => planDurationDays(unknownPlan)).toThrow(/unknown plan/);
	});
});
