import { SUBSCRIPTION_PLAN } from '$lib/domain/constants/subscription-plan';
import { asChildId } from '$lib/domain/ids';
// tests/unit/services/plan-limit-service.test.ts
// plan-limit-service ユニットテスト (#0196, #0269, #0270)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #2919: resolvePlanTier が getDebugPlanTier (debug-plan.ts) を参照するようになったため、
// debug-plan が import する $app/environment.dev を切替可能に mock する
// (tests/unit/server/debug-plan.test.ts と同パターン)。
const devState = { dev: true };
vi.mock('$app/environment', () => ({
	get dev() {
		return devState.dev;
	},
}));

// mock repos
const mockFindAllChildren = vi.fn();
const mockFindActivities = vi.fn();
const mockFindActivitiesByChild = vi.fn();
const mockFindTemplatesByChild = vi.fn();
const mockFindTenantMembers = vi.fn();
const mockFindTenantInvites = vi.fn().mockResolvedValue([]);
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: { findAllChildren: mockFindAllChildren },
		activity: { findActivities: mockFindActivities },
		childActivity: { findActivitiesByChild: mockFindActivitiesByChild },
		checklist: { findTemplatesByChild: mockFindTemplatesByChild },
		auth: { findTenantMembers: mockFindTenantMembers, findTenantInvites: mockFindTenantInvites },
	}),
}));

// #4723: モード判定の実体は auth-mode.ts (factory は re-export)。plan-limit-service など
// 直接 auth-mode を import する側にも同じ値が見えるよう、両方を差し替える。
vi.mock('$lib/server/auth/auth-mode', () => ({
	getAuthMode: () => process.env.AUTH_MODE ?? 'local',
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
	applyRetentionFilter,
	checkActivityLimit,
	checkChecklistTemplateLimit,
	checkChildLimit,
	checkFamilyMemberLimit,
	getHistoryCutoffDate,
	getPlanLimits,
	isPaidTier,
	resolveFullPlanTier,
	resolvePlanTier,
} from '$lib/server/services/plan-limit-service';

describe('plan-limit-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		devState.dev = true;
		delete process.env.DEBUG_PLAN;
	});

	describe('resolvePlanTier', () => {
		// #758 / #2919: dev の DEBUG_PLAN は mode 強制 (local / anonymous = family) より優先する。
		// tests/CLAUDE.md §「プラン別 seed fixture」が「E2E は DEBUG_PLAN でプラン切替」と
		// 文書化しているのに、従来は local 分岐が先に評価され DEBUG_PLAN が無視されていた
		// (文書化済み仕様と実装の乖離) ことへの regression guard。
		it('DEBUG_PLAN=free は local mode の family 強制より優先される (#2919)', () => {
			process.env.AUTH_MODE = 'local';
			process.env.DEBUG_PLAN = 'free';
			expect(resolvePlanTier('none')).toBe('free');
		});

		it('DEBUG_PLAN=standard は anonymous mode の family 強制より優先される (#2919)', () => {
			process.env.AUTH_MODE = 'anonymous';
			process.env.DEBUG_PLAN = 'standard';
			expect(resolvePlanTier('active', 'family-monthly')).toBe('standard');
		});

		it('DEBUG_PLAN は dev=false では無効 (本番セーフガード、local は family のまま)', () => {
			devState.dev = false;
			process.env.AUTH_MODE = 'local';
			process.env.DEBUG_PLAN = 'free';
			expect(resolvePlanTier('none')).toBe('family');
		});

		it('DEBUG_PLAN 不正値は無視され従来の mode 判定にフォールバックする', () => {
			process.env.AUTH_MODE = 'local';
			process.env.DEBUG_PLAN = 'bogus';
			expect(resolvePlanTier('none')).toBe('family');
		});

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

		// #2198: Multi-Lambda demo deployment (anonymous Lambda) は plan 制限なし
		// (ADR-0048 §決定 P-1.6/P-1.7/P-1.8、AnonymousAuthProvider が ACTIVE/all-allow と整合)
		it('anonymous mode: none → family (demo Lambda = unlimited)', () => {
			process.env.AUTH_MODE = 'anonymous';
			expect(resolvePlanTier('none')).toBe('family');
		});

		it('anonymous mode: active → family (license/plan に関わらず family 固定)', () => {
			process.env.AUTH_MODE = 'anonymous';
			expect(resolvePlanTier('active')).toBe('family');
			expect(resolvePlanTier('active', 'monthly')).toBe('family');
			expect(resolvePlanTier('active', 'family-monthly')).toBe('family');
		});

		it('anonymous mode: expired/suspended でも family (demo は plan 制限を持たない)', () => {
			process.env.AUTH_MODE = 'anonymous';
			expect(resolvePlanTier('expired')).toBe('family');
			expect(resolvePlanTier('suspended')).toBe('family');
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
			expect(limits.canFreeTextMessage).toBe(false);
			expect(limits.canCustomReward).toBe(false);
			expect(limits.canSiblingRanking).toBe(false);
		});

		it('standard tier limits', () => {
			const limits = getPlanLimits('standard');
			expect(limits.maxChildren).toBeNull();
			expect(limits.maxActivities).toBeNull();
			expect(limits.historyRetentionDays).toBe(365);
			expect(limits.canExport).toBe(true);
			expect(limits.canFreeTextMessage).toBe(false);
			expect(limits.canCustomReward).toBe(true);
			expect(limits.canSiblingRanking).toBe(false);
		});

		it('family tier limits', () => {
			const limits = getPlanLimits('family');
			expect(limits.maxChildren).toBeNull();
			expect(limits.maxActivities).toBeNull();
			expect(limits.historyRetentionDays).toBeNull();
			expect(limits.canExport).toBe(true);
			expect(limits.canFreeTextMessage).toBe(true);
			expect(limits.canCustomReward).toBe(true);
			expect(limits.canSiblingRanking).toBe(true);
		});

		// #782: きょうだいランキングは family 限定
		it('canSiblingRanking: only family can use sibling ranking', () => {
			expect(getPlanLimits('free').canSiblingRanking).toBe(false);
			expect(getPlanLimits('standard').canSiblingRanking).toBe(false);
			expect(getPlanLimits('family').canSiblingRanking).toBe(true);
		});
	});

	describe('getHistoryCutoffDate', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		/** JST 基準で `todayJst - days` の YYYY-MM-DD を算出（runner の local TZ 非依存）。 */
		const jstCutoff = (todayJst: string, days: number): string => {
			const d = new Date(`${todayJst}T00:00:00Z`);
			d.setUTCDate(d.getUTCDate() - days);
			return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
		};

		it('free: returns date 90 days ago (JST 基準)', () => {
			const cutoff = getHistoryCutoffDate('free');
			expect(cutoff).not.toBeNull();
			// #3593 ②: JST 基準（todayDateJST 起点）で期待値を算出。実 impl と独立に JST 減算する。
			const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
			expect(cutoff).toBe(jstCutoff(todayJst, 90));
		});

		it('standard: returns date 365 days ago (JST 基準)', () => {
			const cutoff = getHistoryCutoffDate('standard');
			expect(cutoff).not.toBeNull();
			const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
			expect(cutoff).toBe(jstCutoff(todayJst, 365));
		});

		it('family: returns null (no limit)', () => {
			const cutoff = getHistoryCutoffDate('family');
			expect(cutoff).toBeNull();
		});

		it('cutoff date format is YYYY-MM-DD', () => {
			const cutoff = getHistoryCutoffDate('free');
			expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});

		// #3593 ②: JST 深夜境界の TZ 整合。UTC 上では前日だが JST では当日となる瞬間
		// (UTC 20:00 = JST 翌 05:00) では、cutoff は JST 当日基準で算出されねばならない。
		// 旧実装は new Date() + local getters で Lambda(UTC) だと 1 日ずれ、0:00〜9:00 JST に
		// 記録された明細が保持期間判定で 1 日早く削除/残置される (retention 監査契約 #729 違反)。
		it('JST 深夜境界: UTC 前日 20:00 (=JST 当日 05:00) でも cutoff は JST 当日基準', () => {
			// 2026-01-14T20:00:00Z ⇔ JST 2026-01-15 05:00。JST today = 2026-01-15。
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-01-14T20:00:00Z'));
			// free = 90 日: 2026-01-15 − 90 日 = 2025-10-17 (JST 基準)。
			// 旧 UTC-local 実装なら 2026-01-14 − 90 日 = 2025-10-16 となり 1 日ずれる。
			expect(getHistoryCutoffDate('free')).toBe('2025-10-17');
		});
	});

	// #756: プラン別保持期間フィルタの挙動検証
	describe('applyRetentionFilter', () => {
		// 日付境界フレーキー対策: テスト中の時刻を固定する
		const FIXED_NOW = new Date('2026-04-12T12:00:00Z');

		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(FIXED_NOW);
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		// helper: FIXED_NOW 基準で N 日前の YYYY-MM-DD
		const daysAgo = (n: number) => {
			const d = new Date(FIXED_NOW);
			d.setDate(d.getDate() - n);
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		};

		describe('free プラン (90 日保持)', () => {
			it('from 未指定 → 90 日前の cutoff を設定する', () => {
				const result = applyRetentionFilter('free');
				expect(result.from).toBe(daysAgo(90));
				expect(result.to).toBeUndefined();
			});

			it('from が 90 日より古い → cutoff に切り上げる（90 日以前のログは表示されない）', () => {
				const result = applyRetentionFilter('free', { from: daysAgo(365) });
				expect(result.from).toBe(daysAgo(90));
			});

			it('from が 90 日以内 → そのまま保持する', () => {
				const recent = daysAgo(30);
				const result = applyRetentionFilter('free', { from: recent });
				expect(result.from).toBe(recent);
			});

			it('to は常にそのまま保持する', () => {
				const to = daysAgo(0);
				const result = applyRetentionFilter('free', { from: daysAgo(365), to });
				expect(result.to).toBe(to);
				expect(result.from).toBe(daysAgo(90));
			});
		});

		describe('standard プラン (365 日保持)', () => {
			it('from 未指定 → 365 日前の cutoff を設定する', () => {
				const result = applyRetentionFilter('standard');
				expect(result.from).toBe(daysAgo(365));
			});

			it('from が 365 日より古い → cutoff に切り上げる（365 日以前は表示されない）', () => {
				const result = applyRetentionFilter('standard', { from: daysAgo(500) });
				expect(result.from).toBe(daysAgo(365));
			});

			it('from が 90 日前 → そのまま保持する（free では cutoff 切り上げだが standard は 90 日以前も見える）', () => {
				const ninetyDaysAgo = daysAgo(90);
				const result = applyRetentionFilter('standard', { from: ninetyDaysAgo });
				expect(result.from).toBe(ninetyDaysAgo);
			});

			it('from が 200 日前 → そのまま保持する（cutoff より新しいため）', () => {
				const twoHundredDaysAgo = daysAgo(200);
				const result = applyRetentionFilter('standard', { from: twoHundredDaysAgo });
				expect(result.from).toBe(twoHundredDaysAgo);
			});
		});

		describe('family プラン (無期限)', () => {
			it('from 未指定 → options をそのまま返す (cutoff を設定しない)', () => {
				const result = applyRetentionFilter('family');
				expect(result.from).toBeUndefined();
				expect(result.to).toBeUndefined();
			});

			it('from が非常に古くても切り上げない（全期間のログが表示される）', () => {
				const veryOld = daysAgo(10000);
				const result = applyRetentionFilter('family', { from: veryOld });
				expect(result.from).toBe(veryOld);
			});

			it('to を含む options をそのまま返す', () => {
				const from = daysAgo(1000);
				const to = daysAgo(0);
				const result = applyRetentionFilter('family', { from, to });
				expect(result).toEqual({ from, to });
			});
		});

		it('options を未指定で呼び出しても安全（デフォルト引数）', () => {
			// free/standard は cutoff が設定されるが、crash せずに from が埋まる
			expect(() => applyRetentionFilter('free')).not.toThrow();
			expect(() => applyRetentionFilter('standard')).not.toThrow();
			expect(() => applyRetentionFilter('family')).not.toThrow();
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
				{ id: '1', nickname: 'a' },
				{ id: '2', nickname: 'b' },
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

		// #2198: anonymous Lambda は family tier 相当で limit bypass
		// 5 子供 fixture (たろう/ひな/けんた/さくら/けいすけ) が「上限警告 + アップグレード CTA」を
		// 表示せず、LP SS carousel-4 が訴求毀損しないことを保証する (ADR-0048 §決定 P-1.6)
		it('anonymous: always allowed (demo Lambda = family tier, max=null)', async () => {
			process.env.AUTH_MODE = 'anonymous';
			const result = await checkChildLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
			// resolvePlanTier 早期 return により findAllChildren は呼ばれない
			expect(mockFindAllChildren).not.toHaveBeenCalled();
		});

		it('anonymous: 5 子供 fixture でも allowed (limit bypass、demo の content parity 保護)', async () => {
			process.env.AUTH_MODE = 'anonymous';
			// 仮に findAllChildren が 5 件返す状況でも family tier 早期 return で limit=null
			mockFindAllChildren.mockResolvedValue([
				{ id: '1', nickname: 'たろう' },
				{ id: '2', nickname: 'ひな' },
				{ id: '3', nickname: 'けんた' },
				{ id: '4', nickname: 'さくら' },
				{ id: '5', nickname: 'けいすけ' },
			]);
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
			expect(mockFindActivitiesByChild).not.toHaveBeenCalled();
		});

		it('free (cognito): allowed when tenant-wide custom count is under limit (per-child sum, #2362)', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindAllChildren.mockResolvedValue([{ id: '10' }, { id: '20' }]);
			mockFindActivitiesByChild
				.mockResolvedValueOnce([{ id: '101', source: 'custom' }])
				.mockResolvedValueOnce([{ id: '201', source: 'custom' }]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(2);
			expect(result.max).toBe(3);
			expect(mockFindActivitiesByChild).toHaveBeenCalledWith('10', 'tenant1');
			expect(mockFindActivitiesByChild).toHaveBeenCalledWith('20', 'tenant1');
		});

		it('free (cognito): blocked when tenant-wide custom count meets limit (per-child sum, #2362)', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindAllChildren.mockResolvedValue([{ id: '10' }, { id: '20' }, { id: '30' }]);
			mockFindActivitiesByChild
				.mockResolvedValueOnce([{ id: '101', source: 'custom' }])
				.mockResolvedValueOnce([{ id: '201', source: 'custom' }])
				.mockResolvedValueOnce([{ id: '301', source: 'custom' }]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(3);
			expect(result.max).toBe(3);
		});

		it('free (cognito): system activities are not counted (per-child loop)', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindAllChildren.mockResolvedValue([{ id: '10' }]);
			mockFindActivitiesByChild.mockResolvedValueOnce([
				{ id: '101', source: 'system' },
				{ id: '102', source: 'system' },
				{ id: '103', source: 'custom' },
			]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(1);
		});

		it('free (cognito): no children → current=0 allowed', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindAllChildren.mockResolvedValue([]);
			const result = await checkActivityLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(0);
			expect(mockFindActivitiesByChild).not.toHaveBeenCalled();
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
			const result = await checkChecklistTemplateLimit('tenant1', 'active', asChildId(1));
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
			expect(mockFindTemplatesByChild).not.toHaveBeenCalled();
		});

		it('family: always allowed (max=null)', async () => {
			process.env.AUTH_MODE = 'cognito';
			const result = await checkChecklistTemplateLimit('tenant1', 'active', asChildId(1));
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
		});

		it('free (cognito): allowed when under limit (0/3)', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTemplatesByChild.mockResolvedValue([]);
			const result = await checkChecklistTemplateLimit('tenant1', 'none', asChildId(1));
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(0);
			expect(result.max).toBe(3);
		});

		it('free (cognito): allowed at 2/3', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTemplatesByChild.mockResolvedValue([
				{ id: '1', name: 'あさ', isActive: 1 },
				{ id: '2', name: 'よる', isActive: 1 },
			]);
			const result = await checkChecklistTemplateLimit('tenant1', 'none', asChildId(1));
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(2);
			expect(result.max).toBe(3);
		});

		it('free (cognito): blocked at exactly 3/3', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTemplatesByChild.mockResolvedValue([
				{ id: '1', name: 'あさ', isActive: 1 },
				{ id: '2', name: 'ひる', isActive: 1 },
				{ id: '3', name: 'よる', isActive: 1 },
			]);
			const result = await checkChecklistTemplateLimit('tenant1', 'none', asChildId(1));
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(3);
			expect(result.max).toBe(3);
		});

		it('free (cognito): 非アクティブ (無効化) テンプレも上限に含まれる', async () => {
			// toggle で isActive=0 にしてもスロットは消費。
			// findTemplatesByChild は includeInactive=true で呼び出される前提。
			process.env.AUTH_MODE = 'cognito';
			mockFindTemplatesByChild.mockResolvedValue([
				{ id: '1', name: 'あさ', isActive: 0 },
				{ id: '2', name: 'ひる', isActive: 0 },
				{ id: '3', name: 'よる', isActive: 1 },
			]);
			const result = await checkChecklistTemplateLimit('tenant1', 'none', asChildId(1));
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(3);
			// 呼び出しは (childId, tenantId, includeInactive=true) の順
			expect(mockFindTemplatesByChild).toHaveBeenCalledWith('1', 'tenant1', true);
		});

		it('free (cognito): 子ごとにカウントされる (childId をそのまま repo に渡す)', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTemplatesByChild.mockResolvedValue([]);
			await checkChecklistTemplateLimit('tenant1', 'none', asChildId(42));
			expect(mockFindTemplatesByChild).toHaveBeenCalledWith('42', 'tenant1', true);
		});

		it('local: always allowed (selfhost = family tier)', async () => {
			process.env.AUTH_MODE = 'local';
			const result = await checkChecklistTemplateLimit('tenant1', 'none', asChildId(1));
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

	// #1111: 家族メンバー招待のプラン別制限
	describe('getPlanLimits - maxFamilyMembers (#1111)', () => {
		it('free: 1 (owner only, no invites)', () => {
			expect(getPlanLimits('free').maxFamilyMembers).toBe(1);
		});
		it('standard: 4 (owner + 3 family members)', () => {
			expect(getPlanLimits('standard').maxFamilyMembers).toBe(4);
		});
		it('family: null (unlimited)', () => {
			expect(getPlanLimits('family').maxFamilyMembers).toBeNull();
		});
	});

	describe('checkFamilyMemberLimit (#1111)', () => {
		/** 未失効の招待を表す期限 (#4723)。 */
		const futureIso = () => new Date(Date.now() + 86_400_000).toISOString();

		it('free (cognito): blocked (owner only, max=1)', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'owner', tenantId: 'tenant1', role: 'owner', joinedAt: new Date().toISOString() },
			]);
			const result = await checkFamilyMemberLimit('tenant1', 'none');
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(1);
			expect(result.max).toBe(1);
		});

		it('standard (cognito): allowed when under limit (1/4)', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'owner', tenantId: 'tenant1', role: 'owner', joinedAt: new Date().toISOString() },
			]);
			const result = await checkFamilyMemberLimit('tenant1', 'active');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(1);
			expect(result.max).toBe(4);
		});

		// #4723: maxFamilyMembers は standard (4) / family (無制限) で唯一値が割れる上限。
		// planId を渡さないと resolveFullPlanTier が有料契約を一律 standard に落とし、
		// family 世帯が 4 人で頭打ちになる (下の "blocked at exactly 4/4" と同じ入力で結果が割れる)。
		it('#4723 family plan (cognito): planId を渡すと無制限になる', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'u1', tenantId: 'tenant1', role: 'owner', joinedAt: new Date().toISOString() },
				{ userId: 'u2', tenantId: 'tenant1', role: 'parent', joinedAt: new Date().toISOString() },
				{ userId: 'u3', tenantId: 'tenant1', role: 'child', joinedAt: new Date().toISOString() },
				{ userId: 'u4', tenantId: 'tenant1', role: 'child', joinedAt: new Date().toISOString() },
			]);

			const result = await checkFamilyMemberLimit('tenant1', 'active', {
				planId: SUBSCRIPTION_PLAN.FAMILY_MONTHLY,
			});

			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
		});

		// planId が standard 系なら従来どおり 4 人上限 (family 判定が広がりすぎないこと)
		it('#4723 standard plan (cognito): planId を渡しても上限は 4 のまま', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'u1', tenantId: 'tenant1', role: 'owner', joinedAt: new Date().toISOString() },
			]);

			const result = await checkFamilyMemberLimit('tenant1', 'active', {
				planId: SUBSCRIPTION_PLAN.MONTHLY,
			});

			expect(result.allowed).toBe(true);
			expect(result.max).toBe(4);
		});

		// #4723: 発行時は「既存メンバー + 未受諾の招待」で数える。数えないと残り 1 枠に何通でも
		// 発行でき、最初に受諾した人以外は受諾時に弾かれる (発行者には成功に見える)。
		it('#4723 発行時は未受諾の招待も枠として数える', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'owner', tenantId: 'tenant1', role: 'owner', joinedAt: new Date().toISOString() },
			]);
			mockFindTenantInvites.mockResolvedValue([
				{ inviteId: 'i-1', status: 'pending', expiresAt: futureIso() },
				{ inviteId: 'i-2', status: 'pending', expiresAt: futureIso() },
				{ inviteId: 'i-3', status: 'pending', expiresAt: futureIso() },
			]);

			const result = await checkFamilyMemberLimit('tenant1', 'active', {
				countPendingInvites: true,
			});

			expect(result.current).toBe(4);
			expect(result.allowed).toBe(false);
		});

		it('#4723 期限切れ / 取消済 / 受諾済の招待は枠を占有しない', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'owner', tenantId: 'tenant1', role: 'owner', joinedAt: new Date().toISOString() },
			]);
			mockFindTenantInvites.mockResolvedValue([
				{
					inviteId: 'i-expired',
					status: 'pending',
					expiresAt: new Date(Date.now() - 1000).toISOString(),
				},
				{ inviteId: 'i-revoked', status: 'revoked', expiresAt: futureIso() },
				{ inviteId: 'i-accepted', status: 'accepted', expiresAt: futureIso() },
			]);

			const result = await checkFamilyMemberLimit('tenant1', 'active', {
				countPendingInvites: true,
			});

			expect(result.current).toBe(1);
			expect(result.allowed).toBe(true);
		});

		// 受諾時に未受諾の招待を数えると、いま受諾しようとしている招待自身を二重に数えてしまう
		it('#4723 受諾時 (既定) は招待を数えない', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'owner', tenantId: 'tenant1', role: 'owner', joinedAt: new Date().toISOString() },
			]);
			mockFindTenantInvites.mockResolvedValue([
				{ inviteId: 'i-1', status: 'pending', expiresAt: futureIso() },
			]);

			const result = await checkFamilyMemberLimit('tenant1', 'active');

			expect(result.current).toBe(1);
			expect(mockFindTenantInvites).not.toHaveBeenCalled();
		});

		it('standard (cognito): allowed at 3/4', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'u1', tenantId: 'tenant1', role: 'owner', joinedAt: new Date().toISOString() },
				{ userId: 'u2', tenantId: 'tenant1', role: 'parent', joinedAt: new Date().toISOString() },
				{ userId: 'u3', tenantId: 'tenant1', role: 'child', joinedAt: new Date().toISOString() },
			]);
			const result = await checkFamilyMemberLimit('tenant1', 'active');
			expect(result.allowed).toBe(true);
			expect(result.current).toBe(3);
			expect(result.max).toBe(4);
		});

		it('standard (cognito): blocked at exactly 4/4', async () => {
			process.env.AUTH_MODE = 'cognito';
			mockFindTenantMembers.mockResolvedValue([
				{ userId: 'u1', tenantId: 'tenant1', role: 'owner', joinedAt: new Date().toISOString() },
				{ userId: 'u2', tenantId: 'tenant1', role: 'parent', joinedAt: new Date().toISOString() },
				{ userId: 'u3', tenantId: 'tenant1', role: 'child', joinedAt: new Date().toISOString() },
				{ userId: 'u4', tenantId: 'tenant1', role: 'child', joinedAt: new Date().toISOString() },
			]);
			const result = await checkFamilyMemberLimit('tenant1', 'active');
			expect(result.allowed).toBe(false);
			expect(result.current).toBe(4);
			expect(result.max).toBe(4);
		});

		it('local: always allowed (selfhost = family tier, max=null)', async () => {
			process.env.AUTH_MODE = 'local';
			const result = await checkFamilyMemberLimit('tenant1', 'none');
			expect(result.allowed).toBe(true);
			expect(result.max).toBeNull();
			expect(mockFindTenantMembers).not.toHaveBeenCalled();
		});
	});
});
