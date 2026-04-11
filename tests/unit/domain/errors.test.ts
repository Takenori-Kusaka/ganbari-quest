// tests/unit/domain/errors.test.ts
// #744: PlanLimitError 共有型の単体テスト

import { describe, expect, it } from 'vitest';
import {
	createPlanLimitError,
	isPlanLimitError,
	type PlanLimitError,
} from '../../../src/lib/domain/errors';

describe('#744 PlanLimitError', () => {
	describe('createPlanLimitError', () => {
		it('free → standard のアップセルエラーを構築する', () => {
			const err = createPlanLimitError(
				'free',
				'standard',
				'AI 活動提案はスタンダードプラン以上でご利用いただけます',
			);
			expect(err).toEqual({
				code: 'PLAN_LIMIT_EXCEEDED',
				message: 'AI 活動提案はスタンダードプラン以上でご利用いただけます',
				currentTier: 'free',
				requiredTier: 'standard',
				upgradeUrl: '/admin/license',
			});
		});

		it('standard → family のアップセルエラーを構築する', () => {
			const err = createPlanLimitError(
				'standard',
				'family',
				'きょうだいランキングはファミリープラン限定です',
			);
			expect(err.currentTier).toBe('standard');
			expect(err.requiredTier).toBe('family');
			expect(err.upgradeUrl).toBe('/admin/license');
		});

		it('upgradeUrl は常に /admin/license で固定', () => {
			const err = createPlanLimitError('free', 'family', 'msg');
			expect(err.upgradeUrl).toBe('/admin/license');
		});
	});

	describe('isPlanLimitError', () => {
		it('正しい形式を true 判定する', () => {
			const err: PlanLimitError = {
				code: 'PLAN_LIMIT_EXCEEDED',
				message: 'test',
				currentTier: 'free',
				requiredTier: 'standard',
				upgradeUrl: '/admin/license',
			};
			expect(isPlanLimitError(err)).toBe(true);
		});

		it('code が違えば false', () => {
			expect(
				isPlanLimitError({
					code: 'VALIDATION_ERROR',
					message: 'test',
					currentTier: 'free',
					requiredTier: 'standard',
					upgradeUrl: '/admin/license',
				}),
			).toBe(false);
		});

		it('currentTier が不正値なら false', () => {
			expect(
				isPlanLimitError({
					code: 'PLAN_LIMIT_EXCEEDED',
					message: 'test',
					currentTier: 'premium',
					requiredTier: 'standard',
					upgradeUrl: '/admin/license',
				}),
			).toBe(false);
		});

		it('requiredTier が free なら false（free へのアップセルはあり得ない）', () => {
			expect(
				isPlanLimitError({
					code: 'PLAN_LIMIT_EXCEEDED',
					message: 'test',
					currentTier: 'free',
					requiredTier: 'free',
					upgradeUrl: '/admin/license',
				}),
			).toBe(false);
		});

		it('upgradeUrl が違う path なら false', () => {
			expect(
				isPlanLimitError({
					code: 'PLAN_LIMIT_EXCEEDED',
					message: 'test',
					currentTier: 'free',
					requiredTier: 'standard',
					upgradeUrl: '/pricing',
				}),
			).toBe(false);
		});

		it('null / undefined / プリミティブは false', () => {
			expect(isPlanLimitError(null)).toBe(false);
			expect(isPlanLimitError(undefined)).toBe(false);
			expect(isPlanLimitError('PLAN_LIMIT_EXCEEDED')).toBe(false);
			expect(isPlanLimitError(403)).toBe(false);
		});
	});
});
