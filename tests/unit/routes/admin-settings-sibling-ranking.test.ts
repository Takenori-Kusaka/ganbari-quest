// tests/unit/routes/admin-settings-sibling-ranking.test.ts
// #782: /admin/settings?/updateSiblingSettings action のプランゲートテスト
//
// テスト観点:
// - free プランで ranking を有効化しようとすると 403
// - standard プランで ranking を有効化しようとすると 403
// - family プランなら ranking を有効化できる
// - ranking を OFF にする操作はプランに関係なく成功する
// - mode は保存されるが、プランゲート時は強制的に false で保存される

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- mocks ----------

const mockSetSetting = vi.fn();
const mockGetSetting = vi.fn();
const mockGetSettings = vi.fn();
vi.mock('$lib/server/db/settings-repo', () => ({
	setSetting: (...args: unknown[]) => mockSetSetting(...args),
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

// Other dependencies the page.server.ts imports but we don't exercise in these tests.
vi.mock('$lib/server/services/data-service', () => ({
	clearAllFamilyData: vi.fn(),
	getDataSummary: vi.fn(),
}));
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn(),
}));
vi.mock('$lib/server/services/default-child-service', () => ({
	getDefaultChildId: vi.fn(),
	setDefaultChildId: vi.fn(),
}));
vi.mock('$lib/server/services/auth-service', () => ({
	changePin: vi.fn(),
}));
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyInquiry: vi.fn(),
}));
vi.mock('$lib/server/services/email-service', () => ({
	sendInquiryConfirmationEmail: vi.fn(),
}));
vi.mock('$lib/server/db/inquiry-repo', () => ({
	generateInquiryId: vi.fn().mockResolvedValue('INQ-TEST'),
	saveInquiry: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { actions } = await import('../../../src/routes/(parent)/admin/settings/+page.server');

// ---------- helpers ----------

type PlanTier = 'free' | 'standard' | 'family';

function createRequest(formValues: Record<string, string>, rankingEnabled: boolean): Request {
	const fd = new FormData();
	for (const [k, v] of Object.entries(formValues)) fd.set(k, v);
	if (rankingEnabled) fd.set('siblingRankingEnabled', 'on');
	return {
		formData: () => Promise.resolve(fd),
	} as unknown as Request;
}

function createEvent(
	tier: PlanTier,
	formValues: Record<string, string>,
	rankingEnabled: boolean,
	tenantId = 't-test',
) {
	mockResolveFullPlanTier.mockResolvedValue(tier);
	mockGetPlanLimits.mockImplementation((t: PlanTier) => ({
		maxChildren: null,
		maxActivities: null,
		historyRetentionDays: null,
		canExport: t !== 'free',
		canFreeTextMessage: t === 'family',
		canCustomReward: t !== 'free',
		canSiblingRanking: t === 'family',
		maxCloudExports: 0,
	}));
	return {
		request: createRequest(formValues, rankingEnabled),
		locals: {
			context: { tenantId, licenseStatus: tier === 'free' ? 'none' : 'active', plan: tier },
		},
	} as unknown as Parameters<NonNullable<typeof actions.updateSiblingSettings>>[0];
}

// ---------- tests ----------

describe('POST /admin/settings?/updateSiblingSettings (#782)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('free プランで ranking を ON にしようとすると 403 + upgradeRequired（PlanLimitError 形式 #787）', async () => {
		const result = (await actions.updateSiblingSettings!(
			createEvent('free', { siblingMode: 'both' }, true),
		)) as {
			status: number;
			data: {
				siblingError: { code: string; currentTier: string; requiredTier: string };
				upgradeRequired: boolean;
			};
		};
		expect(result.status).toBe(403);
		expect(result.data.upgradeRequired).toBe(true);
		// #787: siblingError は PlanLimitError 形式
		expect(result.data.siblingError).toMatchObject({
			code: 'PLAN_LIMIT_EXCEEDED',
			currentTier: 'free',
			requiredTier: 'family',
			upgradeUrl: '/admin/license',
		});
		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('standard プランで ranking を ON にしようとすると 403 + upgradeRequired（PlanLimitError 形式 #787）', async () => {
		const result = (await actions.updateSiblingSettings!(
			createEvent('standard', { siblingMode: 'both' }, true),
		)) as {
			status: number;
			data: {
				siblingError: { code: string; currentTier: string; requiredTier: string };
				upgradeRequired: boolean;
			};
		};
		expect(result.status).toBe(403);
		expect(result.data.upgradeRequired).toBe(true);
		// #787: currentTier は standard、requiredTier は family
		expect(result.data.siblingError).toMatchObject({
			code: 'PLAN_LIMIT_EXCEEDED',
			currentTier: 'standard',
			requiredTier: 'family',
		});
		expect(mockSetSetting).not.toHaveBeenCalled();
	});

	it('family プランなら ranking を ON にできる', async () => {
		const result = await actions.updateSiblingSettings!(
			createEvent('family', { siblingMode: 'both' }, true),
		);
		expect(result).toEqual({ siblingSuccess: true });
		expect(mockSetSetting).toHaveBeenCalledWith('sibling_mode', 'both', 't-test');
		expect(mockSetSetting).toHaveBeenCalledWith('sibling_ranking_enabled', 'true', 't-test');
	});

	it('free プランで ranking OFF のままモードだけ更新する場合は成功する', async () => {
		const result = await actions.updateSiblingSettings!(
			createEvent('free', { siblingMode: 'cooperative' }, false),
		);
		expect(result).toEqual({ siblingSuccess: true });
		expect(mockSetSetting).toHaveBeenCalledWith('sibling_mode', 'cooperative', 't-test');
		expect(mockSetSetting).toHaveBeenCalledWith('sibling_ranking_enabled', 'false', 't-test');
	});

	it('family プランでも ranking OFF を保存できる', async () => {
		const result = await actions.updateSiblingSettings!(
			createEvent('family', { siblingMode: 'competitive' }, false),
		);
		expect(result).toEqual({ siblingSuccess: true });
		expect(mockSetSetting).toHaveBeenCalledWith('sibling_mode', 'competitive', 't-test');
		expect(mockSetSetting).toHaveBeenCalledWith('sibling_ranking_enabled', 'false', 't-test');
	});

	it('不正な siblingMode は 400 を返す', async () => {
		const result = await actions.updateSiblingSettings!(
			createEvent('family', { siblingMode: 'invalid' }, true),
		);
		expect(result).toMatchObject({ status: 400 });
		expect(mockSetSetting).not.toHaveBeenCalled();
	});
});
