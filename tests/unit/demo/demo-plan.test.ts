// tests/unit/demo/demo-plan.test.ts
// #760: デモ画面のプラン切替ヘルパーの単体テスト

import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../../../src/lib/server/auth/types';
import {
	applyDemoPlanToContext,
	DEFAULT_DEMO_PLAN,
	DEMO_PLAN_COOKIE,
	isDemoPlan,
	resolveDemoPlan,
} from '../../../src/lib/server/demo/demo-plan';

describe('demo-plan helpers (#760)', () => {
	describe('isDemoPlan', () => {
		it('受け付ける値: free / standard / family', () => {
			expect(isDemoPlan('free')).toBe(true);
			expect(isDemoPlan('standard')).toBe(true);
			expect(isDemoPlan('family')).toBe(true);
		});

		it('それ以外は false', () => {
			expect(isDemoPlan('premium')).toBe(false);
			expect(isDemoPlan('')).toBe(false);
			expect(isDemoPlan(undefined)).toBe(false);
			expect(isDemoPlan(null)).toBe(false);
			expect(isDemoPlan(123)).toBe(false);
			expect(isDemoPlan('FAMILY')).toBe(false); // case sensitive
		});
	});

	describe('resolveDemoPlan', () => {
		it('クエリ・cookie 共に未指定 → デフォルト (family)', () => {
			expect(resolveDemoPlan(null, undefined)).toBe(DEFAULT_DEMO_PLAN);
			expect(resolveDemoPlan(null, undefined)).toBe('family');
		});

		it('クエリが優先される', () => {
			expect(resolveDemoPlan('standard', 'family')).toBe('standard');
			expect(resolveDemoPlan('free', 'family')).toBe('free');
		});

		it('クエリが無効値 → cookie にフォールバック', () => {
			expect(resolveDemoPlan('premium', 'standard')).toBe('standard');
			expect(resolveDemoPlan('', 'family')).toBe('family');
		});

		it('クエリ無効・cookie 無効 → デフォルト', () => {
			expect(resolveDemoPlan('xxx', 'yyy')).toBe(DEFAULT_DEMO_PLAN);
		});

		it('クエリ無し・cookie 有効 → cookie の値', () => {
			expect(resolveDemoPlan(null, 'free')).toBe('free');
			expect(resolveDemoPlan(null, 'standard')).toBe('standard');
			expect(resolveDemoPlan(null, 'family')).toBe('family');
		});
	});

	describe('applyDemoPlanToContext', () => {
		const baseContext: AuthContext = {
			tenantId: 'demo',
			role: 'owner',
			licenseStatus: 'active',
		};

		it('free → licenseStatus=none, plan=undefined', () => {
			const ctx = applyDemoPlanToContext(baseContext, 'free');
			expect(ctx.licenseStatus).toBe('none');
			expect(ctx.plan).toBeUndefined();
			expect(ctx.tenantId).toBe('demo'); // 他のフィールドは保持
			expect(ctx.role).toBe('owner');
		});

		it('standard → licenseStatus=active, plan=monthly', () => {
			const ctx = applyDemoPlanToContext(baseContext, 'standard');
			expect(ctx.licenseStatus).toBe('active');
			expect(ctx.plan).toBe('monthly');
		});

		it('family → licenseStatus=active, plan=family-monthly', () => {
			const ctx = applyDemoPlanToContext(baseContext, 'family');
			expect(ctx.licenseStatus).toBe('active');
			expect(ctx.plan).toBe('family-monthly');
		});

		it('元のオブジェクトを破壊しない（イミュータブル）', () => {
			const original: AuthContext = {
				tenantId: 'demo',
				role: 'owner',
				licenseStatus: 'active',
			};
			applyDemoPlanToContext(original, 'free');
			expect(original.licenseStatus).toBe('active'); // 変更されていない
			expect(original.plan).toBeUndefined();
		});
	});

	describe('DEMO_PLAN_COOKIE', () => {
		it('cookie 名は demo_plan で固定', () => {
			expect(DEMO_PLAN_COOKIE).toBe('demo_plan');
		});
	});

	describe('plan-limit-service.resolvePlanTier との整合性', () => {
		// resolvePlanTier の判定ロジックと一致させていることを保証する
		// （plan?.startsWith('family') ? 'family' : 'standard'）
		it('standard の plan は family で始まらない', () => {
			const ctx = applyDemoPlanToContext(
				{ tenantId: 'demo', role: 'owner', licenseStatus: 'active' },
				'standard',
			);
			expect(ctx.plan?.startsWith('family')).toBe(false);
		});

		it('family の plan は family で始まる', () => {
			const ctx = applyDemoPlanToContext(
				{ tenantId: 'demo', role: 'owner', licenseStatus: 'active' },
				'family',
			);
			expect(ctx.plan?.startsWith('family')).toBe(true);
		});
	});
});
