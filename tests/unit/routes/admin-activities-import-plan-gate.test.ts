// tests/unit/routes/admin-activities-import-plan-gate.test.ts
// #2894 AC2: 活動取込経路 (importPackToChildren / importPack / bulkCreateForChildren) の
// free tier カスタム活動上限 (maxActivities=3) enforcement 検証。
//
// 根本原因 (#2894): `create` action には checkActivityLimit があったが、marketplace
// 取込経路 (importPackToChildren 等) は gate が漏れており、free tier が上限を超えて
// カスタム活動を取り込めた。SSOT (plan-limit-service.ts PLAN_LIMITS.free.maxActivities=3) と
// 整合させ、取込経路でも上限超過時に PlanLimitError 形式の 403 を返すことを検証する。
//
// **設計判断**: challenges family-gate テスト (admin-challenges-marketplace-import-plan-gate.test.ts)
// と同型。SvelteKit CSRF を回避するため action handler を直接呼び出して検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック ---
const mockRequireTenantId = vi.fn();
const mockResolveFullPlanTier = vi.fn();
const mockCheckActivityLimit = vi.fn();
const mockDispatchImport = vi.fn();
const mockLoadFromMarketplace = vi.fn();
const mockGetAllChildren = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: mockRequireTenantId,
	getAuthMode: vi.fn(() => 'cognito'),
}));

vi.mock('$lib/server/services/plan-limit-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return {
		...actual,
		resolveFullPlanTier: mockResolveFullPlanTier,
		checkActivityLimit: mockCheckActivityLimit,
	};
});

vi.mock('$lib/marketplace', () => ({
	dispatchImport: mockDispatchImport,
}));

vi.mock('$lib/marketplace/sources/marketplace-source', () => ({
	loadFromMarketplace: mockLoadFromMarketplace,
}));

vi.mock('$lib/marketplace/sources/file-source', () => ({
	FileSourceError: class FileSourceError extends Error {},
	loadActivityPackFromFile: vi.fn(),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: mockGetAllChildren,
}));

// 取込経路は 403 で早期 return するため到達しないが、import 解決のため stub を置く。
vi.mock('$lib/server/services/activity-service', () => ({
	createActivity: vi.fn(),
	deleteActivityWithCleanup: vi.fn(),
	getActivities: vi.fn(async () => []),
	getActivityLogCounts: vi.fn(async () => ({})),
	getMainQuestCount: vi.fn(async () => 0),
	hasActivityLogs: vi.fn(async () => false),
	MAIN_QUEST_MAX: 3,
	setActivityVisibility: vi.fn(),
	setMainQuest: vi.fn(),
	updateActivity: vi.fn(),
}));

vi.mock('$lib/server/services/child-activity-copy-service', () => ({
	copyChildActivitiesToSibling: vi.fn(),
	copyChildActivitiesToSiblings: vi.fn(),
}));

vi.mock('$lib/server/db/factory', () => ({
	getRepos: vi.fn(() => ({
		childActivity: {
			findActivitiesByChild: vi.fn(async () => []),
			insertActivitiesBulk: vi.fn(async () => []),
		},
	})),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mod = await import('../../../src/routes/(parent)/admin/activities/+page.server');

type PlanLimitErrorShape = {
	code: 'PLAN_LIMIT_EXCEEDED';
	message: string;
	currentTier: 'free' | 'standard' | 'family';
	requiredTier: 'standard' | 'family';
	upgradeUrl: '/admin/subscription';
};
type ActionResult = {
	status?: number;
	data?: { error: PlanLimitErrorShape | string };
	perChildImport?: boolean;
	imported?: number;
	bulkCreated?: boolean;
	createdCount?: number;
};

const importPackToChildrenAction = mod.actions.importPackToChildren as unknown as (event: {
	request: Request;
	locals: App.Locals;
}) => Promise<ActionResult>;
const bulkCreateForChildrenAction = mod.actions.bulkCreateForChildren as unknown as (event: {
	request: Request;
	locals: App.Locals;
}) => Promise<ActionResult>;

function makeLocals(opts: { licenseStatus?: string; plan?: string } = {}) {
	return {
		context: {
			tenantId: 'tenant-1',
			licenseStatus: opts.licenseStatus ?? 'none',
			plan: opts.plan,
		},
	} as unknown as App.Locals;
}

function makeFormRequest(fields: Record<string, string | number>): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		form.append(k, String(v));
	}
	return new Request('http://localhost/admin/activities', { method: 'POST', body: form });
}

describe('/admin/activities page.server — #2894 取込経路の活動上限 enforcement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireTenantId.mockReturnValue('tenant-1');
		mockGetAllChildren.mockResolvedValue([
			{ id: 902, nickname: 'preschool', tenantId: 'tenant-1' },
			{ id: 903, nickname: 'elementary', tenantId: 'tenant-1' },
		]);
		mockLoadFromMarketplace.mockReturnValue({
			payload: { activities: [{ name: 'a' }] },
			displayName: 'テスト用 activity-pack',
		});
		mockDispatchImport.mockResolvedValue({
			packName: 'テスト用 activity-pack',
			imported: 1,
			skipped: 0,
			total: 1,
			errors: [],
		});
	});

	describe('importPackToChildren (marketplace 取込 → ChildSelectionDialog)', () => {
		it('free tier が上限到達済みなら 403 PlanLimitError を返し dispatchImport を呼ばない', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			mockCheckActivityLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 });

			const result = await importPackToChildrenAction({
				request: makeFormRequest({ packId: 'kinder-starter', childIds: 'all' }),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(result.status).toBe(403);
			const err = result.data?.error as PlanLimitErrorShape;
			expect(err).toMatchObject({
				code: 'PLAN_LIMIT_EXCEEDED',
				currentTier: 'free',
				requiredTier: 'standard',
				upgradeUrl: '/admin/subscription',
			});
			expect(err.message).toContain('3');
			expect(mockDispatchImport).not.toHaveBeenCalled();
		});

		it('free tier が上限未満なら取込を実行する', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			mockCheckActivityLimit.mockResolvedValue({ allowed: true, current: 1, max: 3 });

			const result = await importPackToChildrenAction({
				request: makeFormRequest({ packId: 'kinder-starter', childIds: 'all' }),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(result.status).toBeUndefined();
			expect(result.perChildImport).toBe(true);
			expect(mockDispatchImport).toHaveBeenCalledTimes(1);
		});

		it('paid tier (standard) は上限 null で取込を実行する', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockCheckActivityLimit.mockResolvedValue({ allowed: true, current: 0, max: null });

			const result = await importPackToChildrenAction({
				request: makeFormRequest({ packId: 'kinder-starter', childIds: 'all' }),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(result.status).toBeUndefined();
			expect(mockDispatchImport).toHaveBeenCalledTimes(1);
		});
	});

	describe('bulkCreateForChildren (一括追加)', () => {
		it('free tier が上限到達済みなら 403 PlanLimitError を返す', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			mockCheckActivityLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 });

			const result = await bulkCreateForChildrenAction({
				request: makeFormRequest({
					name: 'あたらしい活動',
					categoryId: 1,
					childIds: 'all',
				}),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(result.status).toBe(403);
			const err = result.data?.error as PlanLimitErrorShape;
			expect(err).toMatchObject({
				code: 'PLAN_LIMIT_EXCEEDED',
				currentTier: 'free',
				requiredTier: 'standard',
			});
		});
	});
});
