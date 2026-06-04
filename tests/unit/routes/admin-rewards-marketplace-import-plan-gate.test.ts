// tests/unit/routes/admin-rewards-marketplace-import-plan-gate.test.ts
// #2894 AC5: license 全廃 cutover 後の reward gate 回帰検証 (OWASP A01 Broken Access Control)。
//
// `/admin/rewards` の `importPresetToChildren` action は #728 で free プランをカスタム
// reward 不可 (`canCustomReward: false`) に gate する。E2E のローカル認証モードは
// `resolvePlanTier` の `getAuthMode()==='local'` 早期 return で常に family になるため、
// free / paid の分岐は unit 層で action handler を直接呼んで検証する
// (admin-challenges-marketplace-import-plan-gate.test.ts と同型。ADR-0006 assertion erosion ban)。
//
// AC3 とも連動: free で返る PlanLimitError オブジェクトを client の getErrorMessage が
// 機能名入りメッセージ ("ごほうび管理はスタンダードプラン以上で…") に正規化することを
// 同テストで貫通検証する (String() 壊れ "[object Object]" の予防)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getErrorMessage, isPlanLimitError } from '../../../src/lib/domain/errors';

// --- モック ---
const mockRequireTenantId = vi.fn();
const mockResolveFullPlanTier = vi.fn();
const mockDispatchImport = vi.fn();
const mockGetAllChildren = vi.fn();
const mockGetMarketplaceItem = vi.fn();

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
	};
});

vi.mock('$lib/marketplace', () => ({
	dispatchImport: mockDispatchImport,
}));

vi.mock('$lib/data/marketplace', () => ({
	getMarketplaceItem: mockGetMarketplaceItem,
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: mockGetAllChildren,
}));

// 403 で弾かれる場合は呼ばれないが、success 路の保険として stub。
vi.mock('$lib/server/services/special-reward-service', () => ({
	addReward: vi.fn(),
	getChildSpecialRewards: vi.fn(),
	getRewardTemplates: vi.fn(),
	saveRewardTemplates: vi.fn(),
}));
vi.mock('$lib/server/services/child-reward-copy-service', () => ({
	copyChildRewardsToSibling: vi.fn(),
	copyChildRewardsToSiblings: vi.fn(),
}));
vi.mock('$lib/server/services/reward-redemption-service', () => ({
	getRedemptionRequestsForParent: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mod = await import('../../../src/routes/(parent)/admin/rewards/+page.server');

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
	packName?: string;
	imported?: number;
	skipped?: number;
	total?: number;
	presetId?: string;
};

const importPresetToChildren = mod.actions.importPresetToChildren as unknown as (event: {
	request: Request;
	locals: App.Locals;
}) => Promise<ActionResult>;

function makeLocals(opts: { licenseStatus?: string; plan?: string; tenantId?: string } = {}) {
	return {
		context: {
			tenantId: opts.tenantId ?? 'tenant-1',
			licenseStatus: opts.licenseStatus ?? 'none',
			plan: opts.plan,
		},
	} as unknown as App.Locals;
}

function makeFormRequest(fields: Record<string, string>): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		form.append(k, v);
	}
	return new Request('http://localhost/admin/rewards', { method: 'POST', body: form });
}

describe('/admin/rewards importPresetToChildren — #2894 free プランゲート回帰 (OWASP A01)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireTenantId.mockReturnValue('tenant-1');
		mockGetAllChildren.mockResolvedValue([
			{ id: 902, nickname: 'preschool', tenantId: 'tenant-1' },
			{ id: 903, nickname: 'elementary', tenantId: 'tenant-1' },
		]);
		mockGetMarketplaceItem.mockImplementation((typeCode: string, presetId: string) =>
			typeCode === 'reward-set' && presetId === 'kinder-rewards'
				? { itemId: presetId, name: 'キンダーごほうび', payload: { rewards: [] } }
				: null,
		);
		mockDispatchImport.mockResolvedValue({
			packName: 'キンダーごほうび',
			imported: 5,
			skipped: 0,
			total: 5,
			errors: [],
		});
	});

	it('free プランでは 403 + 機能名入り PlanLimitError を返し dispatchImport を呼ばない', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');

		const result = await importPresetToChildren({
			request: makeFormRequest({ presetId: 'kinder-rewards', childIds: 'all' }),
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
		// 機能名 + プラン名が含まれる (汎用 "この機能は…" ではない)
		expect(err.message).toContain('ごほうび管理');
		expect(err.message).toContain('スタンダードプラン');
		expect(mockDispatchImport).not.toHaveBeenCalled();
	});

	it('AC3: free の PlanLimitError を getErrorMessage が機能名入り文字列に正規化する ("[object Object]" 防止)', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');

		const result = await importPresetToChildren({
			request: makeFormRequest({ presetId: 'kinder-rewards', childIds: 'all' }),
			locals: makeLocals({ licenseStatus: 'none' }),
		});

		// client (+page.svelte) は actionResult.data?.error を getErrorMessage で表示する。
		const display = getErrorMessage(result.data?.error);
		expect(isPlanLimitError(result.data?.error)).toBe(true);
		expect(display).toBe('ごほうび管理はスタンダードプラン以上でご利用いただけます');
		// String() した場合の壊れ表示にならないこと
		expect(display).not.toContain('[object Object]');
	});

	it('standard プランでは gate を通過し dispatchImport を実行する (cutover 保全後の paid テナント)', async () => {
		mockResolveFullPlanTier.mockResolvedValue('standard');

		const result = await importPresetToChildren({
			request: makeFormRequest({ presetId: 'kinder-rewards', childIds: 'all' }),
			locals: makeLocals({ licenseStatus: 'active', plan: 'monthly' }),
		});

		expect(result.status).toBeUndefined();
		expect(result.perChildImport).toBe(true);
		expect(result.imported).toBe(5);
		expect(mockDispatchImport).toHaveBeenCalledTimes(1);
	});

	it('family プランでも gate を通過し取込成功する', async () => {
		mockResolveFullPlanTier.mockResolvedValue('family');

		const result = await importPresetToChildren({
			request: makeFormRequest({ presetId: 'kinder-rewards', childIds: 'all' }),
			locals: makeLocals({ licenseStatus: 'active', plan: 'family-monthly' }),
		});

		expect(result.status).toBeUndefined();
		expect(result.perChildImport).toBe(true);
		expect(mockDispatchImport).toHaveBeenCalledTimes(1);
	});
});
