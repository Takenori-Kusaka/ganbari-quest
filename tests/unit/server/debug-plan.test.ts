// tests/unit/server/debug-plan.test.ts
// debug-plan ユニットテスト (#758)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// $app/environment.dev をモックで切り替えられるようにする
const devState = { dev: true };
vi.mock('$app/environment', () => ({
	get dev() {
		return devState.dev;
	},
}));

import type { AuthContext } from '$lib/server/auth/types';
import {
	applyDebugPlanOverride,
	getDebugLicenseKeyOverride,
	getDebugPlanOverride,
	getDebugPlanSummary,
	getDebugTrialOverride,
	isDebugPlanActive,
} from '$lib/server/debug-plan';

const ORIGINAL_ENV = { ...process.env };

describe('debug-plan', () => {
	beforeEach(() => {
		devState.dev = true;
		process.env = { ...ORIGINAL_ENV };
		delete process.env.DEBUG_PLAN;
		delete process.env.DEBUG_TRIAL;
		delete process.env.DEBUG_TRIAL_TIER;
		delete process.env.DEBUG_LICENSE_KEY_VALID;
	});

	afterEach(() => {
		process.env = ORIGINAL_ENV;
	});

	describe('getDebugPlanOverride', () => {
		it('dev=false なら常に null（本番セーフガード）', () => {
			devState.dev = false;
			process.env.DEBUG_PLAN = 'family';
			expect(getDebugPlanOverride()).toBeNull();
		});

		it('env 未設定なら null', () => {
			expect(getDebugPlanOverride()).toBeNull();
		});

		it('DEBUG_PLAN=free → licenseStatus=none', () => {
			process.env.DEBUG_PLAN = 'free';
			expect(getDebugPlanOverride()).toEqual({ licenseStatus: 'none', plan: undefined });
		});

		it('DEBUG_PLAN=standard → licenseStatus=active, plan=monthly', () => {
			process.env.DEBUG_PLAN = 'standard';
			expect(getDebugPlanOverride()).toEqual({ licenseStatus: 'active', plan: 'monthly' });
		});

		it('DEBUG_PLAN=family → licenseStatus=active, plan=family-monthly', () => {
			process.env.DEBUG_PLAN = 'family';
			expect(getDebugPlanOverride()).toEqual({ licenseStatus: 'active', plan: 'family-monthly' });
		});

		it('大文字小文字混在も許容', () => {
			process.env.DEBUG_PLAN = ' FAMILY ';
			expect(getDebugPlanOverride()).toEqual({ licenseStatus: 'active', plan: 'family-monthly' });
		});

		it('無効値は null を返して警告', () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			process.env.DEBUG_PLAN = 'enterprise';
			expect(getDebugPlanOverride()).toBeNull();
			expect(warn).toHaveBeenCalled();
			warn.mockRestore();
		});
	});

	describe('getDebugTrialOverride', () => {
		it('dev=false なら常に null', () => {
			devState.dev = false;
			process.env.DEBUG_TRIAL = 'active';
			expect(getDebugTrialOverride()).toBeNull();
		});

		it('env 未設定なら null', () => {
			expect(getDebugTrialOverride()).toBeNull();
		});

		it('DEBUG_TRIAL=active → 7 日後 + standard tier', () => {
			process.env.DEBUG_TRIAL = 'active';
			const override = getDebugTrialOverride();
			expect(override).not.toBeNull();
			expect(override?.tier).toBe('standard');
			expect(override?.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			// 未来日付（今日より後）であること
			expect(new Date(override?.endDate ?? '').getTime()).toBeGreaterThan(Date.now());
		});

		it('DEBUG_TRIAL=active + DEBUG_TRIAL_TIER=family → family tier', () => {
			process.env.DEBUG_TRIAL = 'active';
			process.env.DEBUG_TRIAL_TIER = 'family';
			expect(getDebugTrialOverride()?.tier).toBe('family');
		});

		it('DEBUG_TRIAL=expired → endDate=null, tier=null, trialUsed=true', () => {
			process.env.DEBUG_TRIAL = 'expired';
			expect(getDebugTrialOverride()).toEqual({ endDate: null, tier: null, trialUsed: true });
		});

		it('DEBUG_TRIAL=not-started → endDate=null, tier=null, trialUsed=false', () => {
			process.env.DEBUG_TRIAL = 'not-started';
			expect(getDebugTrialOverride()).toEqual({ endDate: null, tier: null, trialUsed: false });
		});

		it('無効値は null', () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			process.env.DEBUG_TRIAL = 'forever';
			expect(getDebugTrialOverride()).toBeNull();
			warn.mockRestore();
		});

		it('無効な DEBUG_TRIAL_TIER は standard フォールバック', () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			process.env.DEBUG_TRIAL = 'active';
			process.env.DEBUG_TRIAL_TIER = 'enterprise';
			expect(getDebugTrialOverride()?.tier).toBe('standard');
			warn.mockRestore();
		});
	});

	describe('applyDebugPlanOverride', () => {
		const baseContext: AuthContext = {
			tenantId: 't1',
			role: 'owner',
			licenseStatus: 'none',
			plan: undefined,
		};

		it('context=null はそのまま null', () => {
			expect(applyDebugPlanOverride(null)).toBeNull();
		});

		it('env 未設定なら context をそのまま返す', () => {
			expect(applyDebugPlanOverride(baseContext)).toEqual(baseContext);
		});

		it('DEBUG_PLAN=family を適用', () => {
			process.env.DEBUG_PLAN = 'family';
			const result = applyDebugPlanOverride(baseContext);
			expect(result?.licenseStatus).toBe('active');
			expect(result?.plan).toBe('family-monthly');
			// tenantId / role は保持
			expect(result?.tenantId).toBe('t1');
			expect(result?.role).toBe('owner');
		});

		it('dev=false なら override を無視', () => {
			devState.dev = false;
			process.env.DEBUG_PLAN = 'family';
			expect(applyDebugPlanOverride(baseContext)).toEqual(baseContext);
		});
	});

	describe('getDebugLicenseKeyOverride (ADR-0040 P5 / #1221)', () => {
		it('dev=false なら常に null（本番セーフガード）', () => {
			devState.dev = false;
			process.env.DEBUG_LICENSE_KEY_VALID = 'true';
			expect(getDebugLicenseKeyOverride()).toBeNull();
		});

		it('env 未設定なら null', () => {
			expect(getDebugLicenseKeyOverride()).toBeNull();
		});

		it('DEBUG_LICENSE_KEY_VALID=true → { valid: true }', () => {
			process.env.DEBUG_LICENSE_KEY_VALID = 'true';
			expect(getDebugLicenseKeyOverride()).toEqual({ valid: true });
		});

		it('DEBUG_LICENSE_KEY_VALID=false → { valid: false }', () => {
			process.env.DEBUG_LICENSE_KEY_VALID = 'false';
			expect(getDebugLicenseKeyOverride()).toEqual({ valid: false });
		});

		it('大文字小文字混在も許容', () => {
			process.env.DEBUG_LICENSE_KEY_VALID = ' TRUE ';
			expect(getDebugLicenseKeyOverride()).toEqual({ valid: true });
		});

		it('無効値は null を返して警告', () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			process.env.DEBUG_LICENSE_KEY_VALID = 'yes';
			expect(getDebugLicenseKeyOverride()).toBeNull();
			expect(warn).toHaveBeenCalled();
			warn.mockRestore();
		});
	});

	describe('isDebugPlanActive / getDebugPlanSummary', () => {
		it('env 未設定 → false / null', () => {
			expect(isDebugPlanActive()).toBe(false);
			expect(getDebugPlanSummary()).toBeNull();
		});

		it('DEBUG_PLAN=family のみ', () => {
			process.env.DEBUG_PLAN = 'family';
			expect(isDebugPlanActive()).toBe(true);
			expect(getDebugPlanSummary()).toBe('plan=family');
		});

		it('DEBUG_TRIAL=active + tier=family', () => {
			process.env.DEBUG_TRIAL = 'active';
			process.env.DEBUG_TRIAL_TIER = 'family';
			expect(isDebugPlanActive()).toBe(true);
			expect(getDebugPlanSummary()).toBe('trial=active(family)');
		});

		it('plan + trial 両方', () => {
			process.env.DEBUG_PLAN = 'standard';
			process.env.DEBUG_TRIAL = 'expired';
			expect(getDebugPlanSummary()).toBe('plan=standard trial=expired');
		});

		it('DEBUG_LICENSE_KEY_VALID も summary に含まれる', () => {
			process.env.DEBUG_LICENSE_KEY_VALID = 'false';
			expect(isDebugPlanActive()).toBe(true);
			expect(getDebugPlanSummary()).toBe('license=false');
		});

		it('dev=false では summary も null', () => {
			devState.dev = false;
			process.env.DEBUG_PLAN = 'family';
			expect(getDebugPlanSummary()).toBeNull();
		});
	});
});
