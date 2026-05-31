// tests/unit/routes/admin-challenges-marketplace-import-plan-gate.test.ts
// #2402 QM must-3 (OWASP A01 Broken Access Control): family プラン未満は 403
//
// 兄弟チャレンジ機能 (challenge-set import) は family-only。client-side
// `{#if !isFamily}` UI ゲートを直接 POST でバイパスできないよう、サーバー側でも
// family プラン厳密比較を実施することを検証する。
//
// **設計判断**: E2E (Playwright `request.post`) で同等のテストを書こうとすると
// SvelteKit の CSRF 保護 (`Cross-site POST form submissions are forbidden`) で
// family ゲートに到達する前に弾かれるため、unit テスト層で action handler を
// 直接呼び出して検証する。E2E 層は CSRF を通過した正常 flow 用に温存する。
// (ADR-0006: assertion erosion ban — 403 family gate の assertion を弱体化させず
//  単に検証層を移動するだけ)
//
// 対象 actions:
//  - importMarketplaceChallengeSet : UnifiedImportHub Hub 経路 (#2391 Phase 2)
//  - importChallengeSet            : query-param dialog 経路 (#2297 EPIC #2294 ③)
//
// 両方とも family プラン厳密比較 (`tier !== 'family'`) で fail(403) を返す。
// rewards (isPaidTier OK) と異なり challenges は family 厳密比較である点を検証。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック ---
const mockRequireTenantId = vi.fn();
const mockResolveFullPlanTier = vi.fn();
const mockDispatchImport = vi.fn();
const mockLoadFromMarketplace = vi.fn();
const mockGetAllChildren = vi.fn();
const mockGetFamilyStreak = vi.fn();

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

vi.mock('$lib/marketplace/sources/marketplace-source', () => ({
	loadFromMarketplace: mockLoadFromMarketplace,
}));

// #2458-B: sibling-challenge-service 撤去済。admin/challenges は child-challenge-service 経由
// (PR-7 で migrate 済)。本テストは family プランゲート (403) のみ検証するため child-challenge-service
// のメソッド呼出には到達しない (403 で早期 return)。fail 路の保険として stub mock を置く。
const mockGetChallengeGroupsForAdmin = vi.fn();
const mockCreateChildChallenge = vi.fn();
const mockCreateChildChallengesBulk = vi.fn();
const mockDeleteChildChallenge = vi.fn();
const mockBuildPerChildTargets = vi.fn();

vi.mock('$lib/server/services/child-challenge-service', () => ({
	getChallengeGroupsForAdmin: mockGetChallengeGroupsForAdmin,
	createChildChallenge: mockCreateChildChallenge,
	createChildChallengesBulk: mockCreateChildChallengesBulk,
	deleteChildChallenge: mockDeleteChildChallenge,
	buildPerChildTargets: mockBuildPerChildTargets,
}));

vi.mock('$lib/server/services/child-challenge-copy-service', () => ({
	copyChildChallengesToSiblings: vi.fn(),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: mockGetAllChildren,
}));

vi.mock('$lib/server/services/family-streak-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/family-streak-service')>(
		'$lib/server/services/family-streak-service',
	);
	return {
		...actual,
		getFamilyStreak: mockGetFamilyStreak,
	};
});

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mod = await import('../../../src/routes/(parent)/admin/challenges/+page.server');

type PlanLimitErrorShape = {
	code: 'PLAN_LIMIT_EXCEEDED';
	message: string;
	currentTier: 'free' | 'standard' | 'family';
	requiredTier: 'standard' | 'family';
	upgradeUrl: '/admin/license';
};
type ActionResult = {
	status?: number;
	data?: { error: PlanLimitErrorShape | string };
	packName?: string;
	imported?: number;
	skipped?: number;
	total?: number;
	errors?: unknown[];
	presetId?: string;
	challengeSetImport?: {
		presetName: string;
		imported: number;
		skipped: number;
		errors: unknown[];
	};
};

const importMarketplaceChallengeSetAction = mod.actions
	.importMarketplaceChallengeSet as unknown as (event: {
	request: Request;
	locals: App.Locals;
}) => Promise<ActionResult>;

// NOTE: #2362 PR-7 で `importChallengeSet` (query-param dialog 経路) 撤去。
// 取込動線は `importMarketplaceChallengeSet` (UnifiedImportHub 経路) に統合済み。

function makeLocals(opts: { licenseStatus?: string; plan?: string; tenantId?: string } = {}) {
	return {
		context: {
			tenantId: opts.tenantId ?? 'tenant-1',
			licenseStatus: opts.licenseStatus ?? 'none',
			plan: opts.plan,
		},
	} as unknown as App.Locals;
}

function makeFormRequest(
	fields: Record<string, string | number | Array<string | number>>,
): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		if (Array.isArray(v)) {
			for (const item of v) {
				form.append(k, String(item));
			}
		} else {
			form.append(k, String(v));
		}
	}
	return new Request('http://localhost/admin/challenges', { method: 'POST', body: form });
}

describe('/admin/challenges page.server — #2402 family プランゲート (OWASP A01)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireTenantId.mockReturnValue('tenant-1');
		// dispatchImport / loadFromMarketplace が偶発的に呼ばれた場合に備え、
		// success 値を用意。403 で弾かれる場合は呼ばれないことを下で検証する。
		mockLoadFromMarketplace.mockReturnValue({
			payload: { challenges: [] },
			displayName: 'テスト用 challenge-set',
		});
		mockDispatchImport.mockResolvedValue({
			packName: 'テスト用 challenge-set',
			imported: 0,
			skipped: 0,
			total: 0,
			errors: [],
		});
		// #2554 follow-up CUJ-CH2 完全化: CWE-598 guard 用に tenantChildren 解決を mock。
		// family プラン ゲート通過後に `getAllChildren()` で tenant 配下 child set を解決して
		// 渡された childIds が含まれるか検証する (admin-rewards `importPresetToChildren` 同型)。
		mockGetAllChildren.mockResolvedValue([
			{ id: 902, nickname: 'preschool', tenantId: 'tenant-1' },
			{ id: 903, nickname: 'elementary', tenantId: 'tenant-1' },
			{ id: 904, nickname: 'junior', tenantId: 'tenant-1' },
		]);
	});

	describe('importMarketplaceChallengeSet action (UnifiedImportHub 経路)', () => {
		it('free プランでは 403 を返し dispatchImport を呼ばない', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			const result = await importMarketplaceChallengeSetAction({
				request: makeFormRequest({ presetId: 'japan-annual-events' }),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(result.status).toBe(403);
			const err = result.data?.error as PlanLimitErrorShape;
			expect(err).toMatchObject({
				code: 'PLAN_LIMIT_EXCEEDED',
				currentTier: 'free',
				requiredTier: 'family',
				upgradeUrl: '/admin/license',
			});
			expect(err.message).toContain('きょうだいチャレンジ');
			expect(err.message).toContain('プレミアムプラン');
			expect(mockDispatchImport).not.toHaveBeenCalled();
			expect(mockLoadFromMarketplace).not.toHaveBeenCalled();
		});

		it('standard プランでも 403 を返す (family-only、isPaidTier 通過ではない)', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			const result = await importMarketplaceChallengeSetAction({
				request: makeFormRequest({ presetId: 'japan-annual-events' }),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(result.status).toBe(403);
			const err = result.data?.error as PlanLimitErrorShape;
			expect(err).toMatchObject({
				code: 'PLAN_LIMIT_EXCEEDED',
				currentTier: 'standard',
				requiredTier: 'family',
				upgradeUrl: '/admin/license',
			});
			expect(mockDispatchImport).not.toHaveBeenCalled();
			expect(mockLoadFromMarketplace).not.toHaveBeenCalled();
		});

		it('family プランでは family ゲートを通過し dispatchImport を実行する', async () => {
			mockResolveFullPlanTier.mockResolvedValue('family');
			mockDispatchImport.mockResolvedValue({
				packName: '日本の年中行事',
				imported: 3,
				skipped: 0,
				total: 3,
				errors: [],
			});

			// #2362 PR-7: per-child 配信 (childIds body 必須、URL 露出なし = CWE-598)
			const result = await importMarketplaceChallengeSetAction({
				request: makeFormRequest({
					presetId: 'japan-annual-events',
					childIds: [902, 903, 904],
				}),
				locals: makeLocals({ licenseStatus: 'active', plan: 'family_monthly' }),
			});

			expect(result.status).toBeUndefined();
			expect(result.packName).toBe('日本の年中行事');
			expect(result.imported).toBe(3);
			expect(mockDispatchImport).toHaveBeenCalledTimes(1);
		});
	});

	// NOTE: #2362 PR-7 で query-param dialog 経路 `importChallengeSet` action は撤去。
	// 取込動線は `importMarketplaceChallengeSet` (UnifiedImportHub 経路) に統合済み。
	// 同じ family-only gate が Hub 経路で維持されている (上の describe ブロック)。
});
