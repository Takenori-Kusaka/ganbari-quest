// tests/unit/routes/admin-settings-export-gate.test.ts
// #773: /admin/settings load でエクスポート / クラウドエクスポートのプランゲート情報が
// 画面側に配布されることを検証する。
//
// テスト観点:
// - free プランでは canExport=false, maxCloudExports=0 が返る
// - standard プランでは canExport=true, maxCloudExports=3 が返る
// - family プランでは canExport=true, maxCloudExports=10 が返る
// - load が失敗しても canExport / maxCloudExports のデフォルトが返る
// （UI 側の upsell 表示に必要な入力値を保証する）

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mocks ----------

const mockGetSetting = vi.fn();
const mockGetSettings = vi.fn();
vi.mock('$lib/server/db/settings-repo', () => ({
	setSetting: vi.fn(),
	getSetting: (...args: unknown[]) => mockGetSetting(...args),
	getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

const mockResolveFullPlanTier = vi.fn();
const mockGetPlanLimits = vi.fn();
vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	getPlanLimits: (...args: unknown[]) => mockGetPlanLimits(...args),
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

// Other dependencies the page.server.ts imports but we don't exercise here.
const mockGetDataSummary = vi.fn();
vi.mock('$lib/server/services/data-service', () => ({
	clearAllFamilyData: vi.fn(),
	getDataSummary: (...args: unknown[]) => mockGetDataSummary(...args),
}));
const mockGetAllChildren = vi.fn();
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));
const mockGetDefaultChildId = vi.fn();
vi.mock('$lib/server/services/default-child-service', () => ({
	getDefaultChildId: (...args: unknown[]) => mockGetDefaultChildId(...args),
	setDefaultChildId: vi.fn(),
}));
vi.mock('$lib/server/services/auth-service', () => ({ changePin: vi.fn() }));
vi.mock('$lib/server/services/discord-notify-service', () => ({ notifyInquiry: vi.fn() }));
vi.mock('$lib/server/services/email-service', () => ({ sendInquiryConfirmationEmail: vi.fn() }));
vi.mock('$lib/server/db/inquiry-repo', () => ({
	generateInquiryId: vi.fn().mockResolvedValue('INQ-TEST'),
	saveInquiry: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { load } = await import('../../../src/routes/(parent)/admin/settings/+page.server');

// ---------- helpers ----------

type PlanTier = 'free' | 'standard' | 'family';

const PLAN_LIMITS: Record<PlanTier, { canExport: boolean; maxCloudExports: number }> = {
	free: { canExport: false, maxCloudExports: 0 },
	standard: { canExport: true, maxCloudExports: 3 },
	family: { canExport: true, maxCloudExports: 10 },
};

function primeMocks(tier: PlanTier): void {
	mockResolveFullPlanTier.mockResolvedValue(tier);
	mockGetPlanLimits.mockImplementation((t: PlanTier) => ({
		maxChildren: null,
		maxActivities: null,
		historyRetentionDays: null,
		canExport: PLAN_LIMITS[t].canExport,
		canFreeTextMessage: t === 'family',
		canCustomReward: t !== 'free',
		canSiblingRanking: t === 'family',
		maxCloudExports: PLAN_LIMITS[t].maxCloudExports,
	}));
	mockGetDataSummary.mockResolvedValue({
		children: 0,
		activityLogs: 0,
		pointLedger: 0,
		statuses: 0,
		achievements: 0,
		loginBonuses: 0,
		checklistTemplates: 0,
		voices: 0,
	});
	mockGetSetting.mockResolvedValue(null);
	mockGetSettings.mockResolvedValue({});
	mockGetAllChildren.mockResolvedValue([]);
	mockGetDefaultChildId.mockResolvedValue(null);
}

function createLoadEvent(
	tier: PlanTier,
	tenantId = 't-test',
): Parameters<NonNullable<typeof load>>[0] {
	return {
		locals: {
			context: {
				tenantId,
				licenseStatus: tier === 'free' ? 'none' : 'active',
				plan: tier === 'family' ? 'family-monthly' : tier === 'standard' ? 'monthly' : undefined,
			},
		},
	} as unknown as Parameters<NonNullable<typeof load>>[0];
}

// ---------- tests ----------

describe('GET /admin/settings load — export plan gate (#773)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('free プランでは canExport=false, maxCloudExports=0 が返る', async () => {
		primeMocks('free');
		const result = (await load!(createLoadEvent('free'))) as {
			canExport: boolean;
			maxCloudExports: number;
		};
		expect(result.canExport).toBe(false);
		expect(result.maxCloudExports).toBe(0);
	});

	it('standard プランでは canExport=true, maxCloudExports=3 が返る', async () => {
		primeMocks('standard');
		const result = (await load!(createLoadEvent('standard'))) as {
			canExport: boolean;
			maxCloudExports: number;
		};
		expect(result.canExport).toBe(true);
		expect(result.maxCloudExports).toBe(3);
	});

	it('family プランでは canExport=true, maxCloudExports=10 が返る', async () => {
		primeMocks('family');
		const result = (await load!(createLoadEvent('family'))) as {
			canExport: boolean;
			maxCloudExports: number;
		};
		expect(result.canExport).toBe(true);
		expect(result.maxCloudExports).toBe(10);
	});

	it('load 内の getDataSummary が失敗しても canExport / maxCloudExports は plan 解決結果を返す', async () => {
		// #773: plan 解決は try/catch の外にあるため、内部データ取得失敗時も UI ゲート情報は確実に返る
		primeMocks('standard');
		mockGetDataSummary.mockRejectedValue(new Error('db down'));
		const result = (await load!(createLoadEvent('standard'))) as {
			canExport: boolean;
			maxCloudExports: number;
		};
		expect(result.canExport).toBe(true);
		expect(result.maxCloudExports).toBe(3);
	});
});
