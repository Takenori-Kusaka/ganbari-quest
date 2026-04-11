// tests/unit/routes/admin-reports-plan-gate.test.ts
// #735: /admin/reports load で canReceiveWeeklyEmail が plan tier に応じて正しく
// 計算されて UI 側に配布されること、および updateSettings action が free プランの
// フォーム POST を 403 で拒否することを検証する。
//
// 観点:
// - free → canReceiveWeeklyEmail=false
// - standard / family → canReceiveWeeklyEmail=true
// - free で updateSettings を POST → 403（フォーム改竄による回避を防ぐ）
// - standard で updateSettings を POST → setSetting が呼ばれる

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック ---

const mockGetSettings = vi.fn();
const mockSetSetting = vi.fn();
vi.mock('$lib/server/db/settings-repo', () => ({
	getSettings: (...args: unknown[]) => mockGetSettings(...args),
	setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

const mockResolveFullPlanTier = vi.fn();
vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
}));

const mockGetAllChildren = vi.fn();
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));

const mockGenerateReportsForChildren = vi.fn();
vi.mock('$lib/server/services/weekly-report-service', () => ({
	generateReportsForChildren: (...args: unknown[]) => mockGenerateReportsForChildren(...args),
}));

const mockComputeAllChildrenDetailedReport = vi.fn();
vi.mock('$lib/server/services/report-service', () => ({
	computeAllChildrenDetailedReport: (...args: unknown[]) =>
		mockComputeAllChildrenDetailedReport(...args),
}));

vi.mock('$lib/server/services/sibling-ranking-service', () => ({
	getMonthlyRanking: vi.fn().mockResolvedValue(null),
	getRankingTrend: vi.fn().mockResolvedValue(null),
	getWeeklyRanking: vi.fn().mockResolvedValue(null),
	isRankingEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { load, actions } = await import('../../../src/routes/(parent)/admin/reports/+page.server');

// --- ヘルパ ---

type PlanTier = 'free' | 'standard' | 'family';

function primeCommonMocks(tier: PlanTier) {
	mockResolveFullPlanTier.mockResolvedValue(tier);
	mockGetSettings.mockResolvedValue({});
	mockGetAllChildren.mockResolvedValue([{ id: 1, nickname: 'たろう' }]);
	mockGenerateReportsForChildren.mockResolvedValue([]);
	mockComputeAllChildrenDetailedReport.mockResolvedValue([]);
}

function makeLoadEvent(tier: PlanTier) {
	return {
		locals: {
			context: {
				tenantId: 't-test',
				licenseStatus: tier === 'free' ? 'none' : 'active',
				plan:
					tier === 'family'
						? 'family_monthly'
						: tier === 'standard'
							? 'standard_monthly'
							: undefined,
			},
		},
		url: new URL('http://localhost/admin/reports'),
		parent: async () => ({ planTier: tier }),
	} as unknown as Parameters<NonNullable<typeof load>>[0];
}

function makeFormEvent(tier: PlanTier, formEntries: Record<string, string> = {}) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(formEntries)) fd.set(k, v);
	return {
		request: {
			formData: async () => fd,
		},
		locals: {
			context: {
				tenantId: 't-test',
				licenseStatus: tier === 'free' ? 'none' : 'active',
				plan:
					tier === 'family'
						? 'family_monthly'
						: tier === 'standard'
							? 'standard_monthly'
							: undefined,
			},
		},
	} as unknown as Parameters<NonNullable<typeof actions.updateSettings>>[0];
}

// --- tests ---

describe('GET /admin/reports load — weekly mail plan gate (#735)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('free プランでは canReceiveWeeklyEmail=false を返す', async () => {
		primeCommonMocks('free');
		// biome-ignore lint/style/noNonNullAssertion: load is defined
		const result = (await load!(makeLoadEvent('free'))) as {
			canReceiveWeeklyEmail: boolean;
			planTier: PlanTier;
		};
		expect(result.canReceiveWeeklyEmail).toBe(false);
		expect(result.planTier).toBe('free');
	});

	it('standard プランでは canReceiveWeeklyEmail=true を返す', async () => {
		primeCommonMocks('standard');
		// biome-ignore lint/style/noNonNullAssertion: load is defined
		const result = (await load!(makeLoadEvent('standard'))) as {
			canReceiveWeeklyEmail: boolean;
			planTier: PlanTier;
		};
		expect(result.canReceiveWeeklyEmail).toBe(true);
		expect(result.planTier).toBe('standard');
	});

	it('family プランでは canReceiveWeeklyEmail=true を返す', async () => {
		primeCommonMocks('family');
		// biome-ignore lint/style/noNonNullAssertion: load is defined
		const result = (await load!(makeLoadEvent('family'))) as {
			canReceiveWeeklyEmail: boolean;
			planTier: PlanTier;
		};
		expect(result.canReceiveWeeklyEmail).toBe(true);
		expect(result.planTier).toBe('family');
	});
});

describe('POST /admin/reports?/updateSettings — server side plan gate (#735)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('free プランの POST は 403 で拒否し setSetting は呼ばれない', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');

		// biome-ignore lint/style/noNonNullAssertion: action defined
		const result = await actions.updateSettings!(
			makeFormEvent('free', { enabled: 'on', day: 'monday' }),
		);

		// ActionFailure はオブジェクトで返る（throw しない）
		expect((result as { status?: number }).status).toBe(403);
		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('standard プランの POST は setSetting を呼ぶ', async () => {
		mockResolveFullPlanTier.mockResolvedValue('standard');

		// biome-ignore lint/style/noNonNullAssertion: action defined
		const result = await actions.updateSettings!(
			makeFormEvent('standard', { enabled: 'on', day: 'friday' }),
		);

		expect((result as { settingsUpdated?: boolean }).settingsUpdated).toBe(true);
		expect(mockSetSetting).toHaveBeenCalledWith('weekly_report_enabled', '1', 't-test');
		expect(mockSetSetting).toHaveBeenCalledWith('weekly_report_day', 'friday', 't-test');
	});

	it('family プランの POST も setSetting を呼ぶ', async () => {
		mockResolveFullPlanTier.mockResolvedValue('family');

		// biome-ignore lint/style/noNonNullAssertion: action defined
		const result = await actions.updateSettings!(
			makeFormEvent('family', { enabled: '', day: 'sunday' }),
		);

		expect((result as { settingsUpdated?: boolean }).settingsUpdated).toBe(true);
		expect(mockSetSetting).toHaveBeenCalledWith('weekly_report_enabled', '0', 't-test');
	});

	it('standard プランでも無効な曜日は 400', async () => {
		mockResolveFullPlanTier.mockResolvedValue('standard');

		// biome-ignore lint/style/noNonNullAssertion: action defined
		const result = await actions.updateSettings!(
			makeFormEvent('standard', { enabled: 'on', day: 'invalid-day' }),
		);

		expect((result as { status?: number }).status).toBe(400);
		expect(mockSetSetting).not.toHaveBeenCalled();
	});
});
