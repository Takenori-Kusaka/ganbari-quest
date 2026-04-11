// tests/unit/routes/child-layout-plan-info.test.ts
// #789: (child)/+layout.server.ts がプラン情報を正しく配布するかを検証する。
//
// テスト観点:
// - 無料プランで load した場合、planTier=free / planLimits.canSiblingRanking=false
// - standard プランの場合、planTier=standard / isPremium=true
// - family プランの場合、planTier=family / planLimits.canSiblingRanking=true
// - layout の戻り値に planTier / planLimits / isPremium が全て含まれる
//
// 本テストは child UI 側で planTier を参照できるようにした #789 の
// 回帰防止として作成した（Acceptance Criteria の「child UI が planTier
// を参照できる」「プラン依存機能の表示制御」をカバーする）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- service mocks ----------

const mockResolveFullPlanTier = vi.fn();
vi.mock('$lib/server/services/plan-limit-service', async () => {
	// 実体の getPlanLimits / isPaidTier をそのまま使いたいので動的 import で取得する。
	// resolveFullPlanTier のみ差し替える。
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return {
		...actual,
		resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	};
});

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
	getAuthMode: vi.fn(() => 'cognito'),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getChildById: vi.fn().mockResolvedValue({
		id: 1,
		nickname: 'たろうくん',
		uiMode: 'elementary',
		age: 7,
		avatarUrl: null,
	}),
	getAllChildren: vi.fn().mockResolvedValue([]),
}));

vi.mock('$lib/server/db/settings-repo', () => ({
	getSettings: vi.fn().mockResolvedValue({
		point_unit_mode: 'point',
		point_currency: 'JPY',
		point_rate: '1',
	}),
}));

vi.mock('$lib/server/services/point-service', () => ({
	getPointBalance: vi.fn().mockResolvedValue({ balance: 100 }),
}));

vi.mock('$lib/server/services/status-service', () => ({
	getChildStatus: vi.fn().mockResolvedValue({ level: 3, levelTitle: 'かけだし' }),
}));

vi.mock('$lib/server/services/stamp-card-service', () => ({
	getStampCardStatus: vi.fn().mockResolvedValue({
		filledSlots: 2,
		totalSlots: 10,
	}),
}));

vi.mock('$lib/server/services/onboarding-service', () => ({
	markChildScreenVisited: vi.fn().mockResolvedValue(undefined),
}));

const { load } = await import('../../../src/routes/(child)/+layout.server');

// ---------- helpers ----------

type PlanTier = 'free' | 'standard' | 'family';

/**
 * load() は redirect() を投げるパスがあるため型上は `void | Data` になる。
 * 正常系テストでは redirect されない前提なので、戻り値が undefined でないことを
 * 明示的に assert し、以降の assertion のために型を narrow する。
 */
async function loadResolved(tier: PlanTier) {
	const result = await load(createLoadEvent(tier));
	if (!result) throw new Error(`load() returned void for tier=${tier}`);
	return result;
}

function createLoadEvent(tier: PlanTier) {
	return {
		cookies: {
			get: vi.fn((key: string) => (key === 'selectedChildId' ? '1' : undefined)),
			set: vi.fn(),
			delete: vi.fn(),
		},
		url: new URL('http://localhost/home'),
		locals: {
			context: {
				tenantId: 't-test',
				licenseStatus: tier === 'free' ? 'none' : 'active',
				plan: tier,
			},
		},
	} as unknown as Parameters<typeof load>[0];
}

// ---------- tests ----------

describe('(child)/+layout.server.ts プラン情報配布 (#789)', () => {
	beforeEach(() => {
		mockResolveFullPlanTier.mockReset();
	});

	it('free プランの場合 planTier=free / planLimits.canSiblingRanking=false / isPremium=false', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		const result = await loadResolved('free');
		expect(result.planTier).toBe('free');
		expect(result.planLimits.canSiblingRanking).toBe(false);
		expect(result.planLimits.canFreeTextMessage).toBe(false);
		expect(result.planLimits.canCustomReward).toBe(false);
		expect(result.isPremium).toBe(false);
	});

	it('standard プランの場合 planTier=standard / isPremium=true / canSiblingRanking=false', async () => {
		mockResolveFullPlanTier.mockResolvedValue('standard');
		const result = await loadResolved('standard');
		expect(result.planTier).toBe('standard');
		expect(result.planLimits.canCustomReward).toBe(true);
		expect(result.planLimits.canSiblingRanking).toBe(false);
		expect(result.planLimits.canFreeTextMessage).toBe(false);
		expect(result.isPremium).toBe(true);
	});

	it('family プランの場合 planTier=family / canSiblingRanking=true / canFreeTextMessage=true', async () => {
		mockResolveFullPlanTier.mockResolvedValue('family');
		const result = await loadResolved('family');
		expect(result.planTier).toBe('family');
		expect(result.planLimits.canSiblingRanking).toBe(true);
		expect(result.planLimits.canFreeTextMessage).toBe(true);
		expect(result.planLimits.canCustomReward).toBe(true);
		expect(result.isPremium).toBe(true);
	});

	it('layout 戻り値に child / balance / level など既存フィールドも含まれる（後方互換）', async () => {
		mockResolveFullPlanTier.mockResolvedValue('family');
		const result = await loadResolved('family');
		expect(result.child).toBeDefined();
		expect(result.balance).toBe(100);
		expect(result.level).toBe(3);
		expect(result.isPremium).toBe(true);
		// #789 で追加したフィールド
		expect(result.planTier).toBeDefined();
		expect(result.planLimits).toBeDefined();
	});
});
