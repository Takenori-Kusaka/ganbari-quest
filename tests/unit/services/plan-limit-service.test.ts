// tests/unit/services/plan-limit-service.test.ts
// plan-limit-service ユニットテスト (#0196, #0269, #0270)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// mock repos
const mockFindAllChildren = vi.fn();
const mockFindActivities = vi.fn();
const mockFindTemplatesByChild = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: { findAllChildren: mockFindAllChildren },
		activity: { findActivities: mockFindActivities },
		checklist: { findTemplatesByChild: mockFindTemplatesByChild },
	}),
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => process.env.AUTH_MODE ?? 'local',
}));

// mock trial-service (resolveFullPlanTier depends on it)
// #732: resolveFullPlanTier は getTrialStatus を 1 回だけ呼ぶ形に変更
const mockGetTrialStatus = vi.fn().mockResolvedValue({
	isTrialActive: false,
	trialUsed: false,
	trialStartDate: null,
	trialEndDate: null,
	trialTier: null,
	daysRemaining: 0,
	source: null,
});
vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: (...args: unknown[]) => mockGetTrialStatus(...args),
}));

import {
	checkActivityLimit,
	checkChecklistTemplateLimit,
	checkChildLimit,
	getHistoryCutoffDate,
	getPlanLimits,
	isPaidTier,
	resolveFullPlanTier,
	resolvePlanTier,
} from '$lib/server/services/plan-limit-service';

describe('plan-limit-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('resolvePlanTier', () => {
		it('active (no planId) → standard', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active')).toBe('standard');
		});

		it('active + planId=family-monthly → family', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active', 'family-monthly')).toBe('family');
		});

		it('active + planId=family-yearly → family', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active', 'family-yearly')).toBe('family');
		});

		it('active + planId=monthly → standard', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active', 'monthly')).toBe('standard');
		});

		it('active + planId=yearly → standard', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('active', 'yearly')).toBe('standard');
		});

		it('local mode: none → family (selfhost = 全機能解放)', () => {
			process.env.AUTH_MODE = 'local';
			expect(resolvePlanTier('none')).toBe('family');
		});

		it('cognito mode: none → free', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('none')).toBe('free');
		});

		it('cognito mode: expired → free', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('expired')).toBe('free');
		});

		it('cognito mode: suspended → free', () => {
			process.env.AUTH_MODE = 'cognito';
			expect(resolvePlanTier('suspended')).toBe('free');
		});

		it('cognito mode: trial active (standard) → standard', () => {
			process.env.AUTH_MODE = 'cognito';
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 5);
			const endStr = futureDate.toISOString().slice(0, 10);
			expect(resolvePlanTier('none', undefined, endStr, 'standard')).toBe('standard');
		});

		it('cognito mode: trial active (family) → family', () => {
			process.env.AUTH_MODE = 'cognito';
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 5);
			const endStr = futureDate.toISOString().slice(0, 10);
			expect(resolvePlanTier('none', undefined, endStr, 'family')).toBe('family');
		});

		it('cognito mode: trial active (no tier) → standard', () => {
			process.env.AUTH_MODE = 'cognito';
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 5);
			const endStr = futureDate.toISOString().slice(0, 10);
			expect(resolvePlanTier('none', undefined, endStr)).toBe('standard');
		});

		it('cognito mode: trial expired → free', () => {
			process.env.AUTH_MODE = 'cognito';
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 1);
			const endStr = pastDate.toISOString().slice(0, 10);
			expect(resolvePlanTier('none', undefined, endStr)).toBe('free');
		});

		it('active license overrides trial', () => {
			process.env.AUTH_MODE = 'cognito';
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 5);
			const endStr = futureDate.toISOString().slice(0, 10);
			expect(resolvePlanTier('active', 'monthly', endStr)).toBe('standard');
		});
	});

	describe('resolveFullPlanTier', () => {
		it('resolves with trial end date and tier from service', async () => {
			process.env.AUTH_MODE = 'cognito';
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 3);
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-04-01',
				trialEndDate: futureDate.toISOString().slice(0, 10),
				trialTier: 'standard',
				daysRemaining: 3,
				source: 'user_initiated',
			});
			const tier = await resolveFullPlanTier('tenant1', 'none');
			expect(tier).toBe('standard');
			expect(mockGetTrialStatus).toHaveBeenCalledWith('tenant1');
		});

		it('resolves to family when trial is family-tier', async () => {
			process.env.AUTH_MODE = 'cognito';
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 3);
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: true,
				trialUsed: true,
				trialStartDate: '2026-04-01',
				trialEndDate: futureDate.toISOString().slice(0, 10),
				trialTier: 'family',
				daysRemaining: 3,
				source: 'user_initiated',
			});
			const tier = await resolveFullPlanTier('tenant1', 'none');
			expect(tier).toBe('family');
		});

		it('resolves to free when no trial', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: false,
				trialUsed: false,
				trialStartDate: null,
				trialEndDate: null,
				trialTier: null,
				daysRemaining: 0,
				source: null,
			});
			const tier = await resolveFullPlanTier('tenant1', 'none');
			expect(tier).toBe('free');
		});

		it('#732: calls getTrialStatus only once per resolution (no duplicate DB query)', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: false,
				trialUsed: false,
				trialStartDate: null,
				trialEndDate: null,
				trialTier: null,
				daysRemaining: 0,
				source: null,
			});
			await resolveFullPlanTier('tenant1', 'none');
			expect(mockGetTrialStatus).toHaveBeenCalledTimes(1);
		});

		it('#725/#732: trial が非アクティブなら trialTier は無視される', async () => {
			process.env.AUTH_MODE = 'cognito';
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 5);
			mockGetTrialStatus.mockResolvedValue({
				isTrialActive: false,
				trialUsed: true,
				trialStartDate: '2026-03-01',
				trialEndDate: pastDate.toISOString().slice(0, 10),
				trialTier: 'family',
				daysRemaining: 0,
				source: 'user_initiated',
			});
			const tier = await resolveFullPlanTier('tenant1', 'none');
			expect(tier).toBe('free');
		});
	});

	describe('isPaidTier', () => {
		it('free → false', () => {
			expect(isPaidTier('free')).toBe(false);
		});

		it('standard → true', () => {
			expect(isPaidTier('standard')).toBe(true);
		});

		it('family → true', () => {
			expect(isPaidTier('family')).toBe(true);
		});
	});

	describe('getPlanLimits', () => {
		it('free tier limits', () => {
			const limits = getPlanLimits('free');
			expect(limits.maxChildren).toBe(2);
			expect(limits.maxActivities).toBe(3);
			expect(limits.historyRetentionDays).toBe(90);
			expect(limits.canExport).toBe(false);
			expect(limits.canCustomAvatar).toBe(false);
			expect(limits.canFreeTextMessage).toBe(false);
			expect(limits.canCustomReward).toBe(false);
		});

		it('standard tier limits', () => {
			const limits = getPlanLimits('standard');
			expect(limits.maxChildren).toBeNull();
			expect(limits.maxActivities).toBeNull();
			expect(limits.historyRetentionDays).toBe(365);
			expect(limits.canExport).toBe(true);
			expect(limits.canCustomAvatar).toBe(true);
			expect(limits.canFreeTextMessage).toBe(false);
			expect(limits.canCustomReward).toBe(true);
		});

		it('family tier limits', () => {
			const limits = getPlanLimits('family');
			expect(limits.maxChildren).toBeNull();
			expect(limits.maxActivities).toBeNull();
			expect(limits.historyRetentionDays).toBeNull();
			expect(limits.canExport).toBe(true);
			expect(limits.canCustomAvatar).toBe(true);
			expect(limits.canFreeTextMessage).toBe(true);
			expect(limits.canCustomReward).toBe(true);
		});
	});

	describe('getHistoryCutoffDate', () => {
		it('free: returns date 90 days ago', () => {
			const cutoff = getHistoryCutoffDate('free');
			expect(cutoff).not.toBeNull();
			// 実装と同じロジックで期待値を算出（setDate ベース）
			const expected = new Date();
			expected.setDate(expected.getDate() - 90);
			const expectedStr = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
			expect(cutoff).toBe(expectedStr);
		});

		it('standard: returns date 365 days ago', () => {
			const cutoff = getHistoryCutoffDate('standard');
			expect(cutoff).not.toBeNull();
			const expected = new Date();
			expected.setDate(expected.getDate() - 365);
			const expectedStr = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
			expect(cutoff).toBe(expectedStr);
		});

		it('family: returns null (no limit)', () => {
			const cutoff = getHistoryCutoffDate('family');
			expect(cutoff).toBeNull();
		});

		it('cutoff date format is YYYY-MM-DD', () => {
			const cutoff = getHistoryCutoffDate('free');
			expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});
	});

	describe('checkChildLimit', () => {
		it('standard: always allowed', async () => {
			process.env.AUTH_MODE = 'cognito';
			const result = await checkChildLimit('tenant1', 'active');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
			expect(mockFindAllChildren).not.toHaveBeenCalled();
		});

		it('free (cognito): allowed when under limit', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindAllChildren.mockResolvedValue([]);
			const result = await checkChildLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(0);
			expect(result.max).toBe(2);
		});

		it('free (cognito): blocked when at limit', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindAllChildren.mockResolvedValue([
				{ id: 1, nickname: 'a' },
				{ id: 2, nickname: 'b' },
			]);
			const result = await checkChildLimit('tenant1', 'none');
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(2);
			expect(result.max).toBe(2);
		});

		it('local: always allowed (selfhost)', async () => {
			process.env.AUTH_MODE = 'local';
			const result = await checkChildLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
		});
	});

	describe('checkActivityLimit', () => {
		it('standard: always allowed', async () => {
			process.env.AUTH_MODE = 'cognito';
			const result = await checkActivityLimit('tenant1', 'active');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
			expect(mockFindActivities).not.toHaveBeenCalled();
		});

		it('free (cognito): allowed when under limit', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindActivities.mockResolvedValue([
				{ id: 1, source: 'custom' },
				{ id: 2, source: 'custom' },
			]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(2);
			expect(result.max).toBe(3);
		});

		it('free (cognito): blocked when at limit', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindActivities.mockResolvedValue([
				{ id: 1, source: 'custom' },
				{ id: 2, source: 'custom' },
				{ id: 3, source: 'custom' },
			]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(3);
			expect(result.max).toBe(3);
		});

		it('free (cognito): system activities are not counted', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindActivities.mockResolvedValue([
				{ id: 1, source: 'system' },
				{ id: 2, source: 'system' },
				{ id: 3, source: 'custom' },
			]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(1);
		});

		it('local: always allowed (selfhost)', async () => {
			process.env.AUTH_MODE = 'local';
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
		});
	});

	describe('checkChecklistTemplateLimit (#723)', () => {
		it('standard: always allowed (max=null)', async () => {
			process.env.AUTH_MODE = 'cognito';
			const result = await checkChecklistTemplateLimit('tenant1', 'active', 1);
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
			expect(mockFindTemplatesByChild).not.toHaveBeenCalled();
		});

		it('family: always allowed (max=null)', async () => {
			process.env.AUTH_MODE = 'cognito';
			const result = await checkChecklistTemplateLimit('tenant1', 'active', 1);
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
		});

		it('free (cognito): allowed when under limit (0/3)', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTemplatesByChild.mockResolvedValue([]);
			const result = await checkChecklistTemplateLimit('tenant1', 'none', 1);
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(0);
			expect(result.max).toBe(3);
		});

		it('free (cognito): allowed at 2/3', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTemplatesByChild.mockResolvedValue([
				{ id: 1, name: 'あさ', isActive: 1 },
				{ id: 2, name: 'よる', isActive: 1 },
			]);
			const result = await checkChecklistTemplateLimit('tenant1', 'none', 1);
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(2);
			expect(result.max).toBe(3);
		});

		it('free (cognito): blocked at exactly 3/3', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTemplatesByChild.mockResolvedValue([
				{ id: 1, name: 'あさ', isActive: 1 },
				{ id: 2, name: 'ひる', isActive: 1 },
				{ id: 3, name: 'よる', isActive: 1 },
			]);
			const result = await checkChecklistTemplateLimit('tenant1', 'none', 1);
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(3);
			expect(result.max).toBe(3);
		});

		it('free (cognito): 非アクティブ (無効化) テンプレも上限に含まれる', async () => {
			// toggle で isActive=0 にしてもスロットは消費。
			// findTemplatesByChild は includeInactive=true で呼び出される前提。
			process.env.AUTH_MODE = 'cognito';
			mockFindTemplatesByChild.mockResolvedValue([
				{ id: 1, name: 'あさ', isActive: 0 },
				{ id: 2, name: 'ひる', isActive: 0 },
				{ id: 3, name: 'よる', isActive: 1 },
			]);
			const result = await checkChecklistTemplateLimit('tenant1', 'none', 1);
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(3);
			// 呼び出しは (childId, tenantId, includeInactive=true) の順
			expect(mockFindTemplatesByChild).toHaveBeenCalledWith(1, 'tenant1', true);
		});

		it('free (cognito): 子ごとにカウントされる (childId をそのまま repo に渡す)', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTemplatesByChild.mockResolvedValue([]);
			await checkChecklistTemplateLimit('tenant1', 'none', 42);
			expect(mockFindTemplatesByChild).toHaveBeenCalledWith(42, 'tenant1', true);
		});

		it('local: always allowed (selfhost = family tier)', async () => {
			process.env.AUTH_MODE = 'local';
			const result = await checkChecklistTemplateLimit('tenant1', 'none', 1);
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
		});
	});

	describe('getPlanLimits - maxChecklistTemplates (#723)', () => {
		it('free: 3', () => {
			expect(getPlanLimits('free').maxChecklistTemplates).toBe(3);
		});
		it('standard: null (unlimited)', () => {
			expect(getPlanLimits('standard').maxChecklistTemplates).toBeNull();
		});
		it('family: null (unlimited)', () => {
			expect(getPlanLimits('family').maxChecklistTemplates).toBeNull();
		});
	});
});
