// tests/unit/routes/special-rewards-api-plan-gate.test.ts
// #4705 AC3: ごほうび (ショップ商品) を書き込む REST API を無料プランで拒否する。
//
// form action 側 (`/admin/rewards`) には #4584 の gate があったが REST 側には無く、
// `curl -X POST /api/v1/special-rewards/1` で無料プランのまま 201 で作成できた。
// 「画面では鍵、API では素通し」は gate があると信じている側だけが守られる形なので、
// 同じ述語 (`isCustomRewardUnlocked`) を両方が読む。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveFullPlanTier = vi.fn();
vi.mock('$lib/server/services/plan-limit-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return {
		...actual,
		resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	};
});

const mockGrantSpecialReward = vi.fn();
const mockGetChildSpecialRewards = vi.fn();
const mockSaveRewardTemplates = vi.fn();
const mockGetRewardTemplates = vi.fn();
vi.mock('$lib/server/services/special-reward-service', () => ({
	grantSpecialReward: (...args: unknown[]) => mockGrantSpecialReward(...args),
	getChildSpecialRewards: (...args: unknown[]) => mockGetChildSpecialRewards(...args),
	saveRewardTemplates: (...args: unknown[]) => mockSaveRewardTemplates(...args),
	getRewardTemplates: (...args: unknown[]) => mockGetRewardTemplates(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { POST: grantPOST, GET: rewardsGET } = await import(
	'../../../src/routes/api/v1/special-rewards/[childId]/+server'
);
const { PUT: templatesPUT, GET: templatesGET } = await import(
	'../../../src/routes/api/v1/special-rewards/templates/+server'
);

function event(body: unknown, tier: 'free' | 'standard' | 'family', childId = '1') {
	mockResolveFullPlanTier.mockResolvedValue(tier);
	return {
		params: { childId },
		locals: {
			context: {
				tenantId: 't1',
				role: 'owner',
				licenseStatus: tier === 'free' ? 'none' : 'active',
				plan: tier === 'free' ? undefined : 'monthly',
			},
		},
		request: { json: async () => body },
		// biome-ignore lint/suspicious/noExplicitAny: minimal RequestEvent stub for handler unit test
	} as any;
}

const validGrant = { title: 'アイス', points: 10, icon: '🍦', category: 'other' };
const validTemplates = {
	templates: [{ title: 'アイス', points: 10, icon: '🍦', category: 'other' }],
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGrantSpecialReward.mockResolvedValue({ id: 1 });
	mockGetChildSpecialRewards.mockResolvedValue({ rewards: [], totalPoints: 0 });
	mockSaveRewardTemplates.mockResolvedValue(undefined);
	mockGetRewardTemplates.mockResolvedValue([]);
});

describe('#4705 ごほうび REST API のプラン gate', () => {
	it('free: POST /api/v1/special-rewards/[childId] は 403 で、サービスを呼ばない', async () => {
		const res = await grantPOST(event(validGrant, 'free'));
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
		expect(mockGrantSpecialReward).not.toHaveBeenCalled();
	});

	it('free: PUT /api/v1/special-rewards/templates は 403 で、保存しない', async () => {
		const res = await templatesPUT(event(validTemplates, 'free'));
		expect(res.status).toBe(403);
		expect(mockSaveRewardTemplates).not.toHaveBeenCalled();
	});

	it.each(['standard', 'family'] as const)('%s: 書き込みは従来どおり通る', async (tier) => {
		const grantRes = await grantPOST(event(validGrant, tier));
		expect(grantRes.status).toBe(201);
		expect(mockGrantSpecialReward).toHaveBeenCalled();

		const templatesRes = await templatesPUT(event(validTemplates, tier));
		expect(templatesRes.status).toBe(200);
		expect(mockSaveRewardTemplates).toHaveBeenCalled();
	});

	it('free でも読み取り (GET) は通る — 既存のごほうびは無料プランでも閲覧できる', async () => {
		const listRes = await rewardsGET(event(undefined, 'free'));
		expect(listRes.status).toBe(200);
		const templatesRes = await templatesGET(event(undefined, 'free'));
		expect(templatesRes.status).toBe(200);
	});
});
