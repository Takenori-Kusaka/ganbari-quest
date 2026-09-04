// tests/unit/routes/activities-quota-residual-gate.test.ts
// #3740: #3678 same-class 残余 — 課金境界 (maxActivities quota) の producer 側 gating 残余 2 経路の回帰 lock。
//
// 根本原因 (QM Tier2 レビュー実確認):
//   1. api/v1/activities POST が checkActivityLimit 未通過で createActivity を呼び、かつ
//      createActivitySchema が client 供給 source ('seed'/'curriculum' 含む) を受理 +
//      normalizeParentCreatedSource が既知値を透過するため、free ユーザーが
//      `POST {"source":"seed"}` 反復で countsTowardActivityQuota=false の活動を無制限作成できた。
//   2. copyFromChild action が checkActivityLimit 未通過で copy を実行 (copy は元活動の
//      source='custom' を保全して quota を消費するため、上限到達後も copy で増殖できた)。
//
// 修正 (failing-test-first、ADR-0061):
//   1. api/v1 POST に checkActivityLimit gate + wire source を信頼せず PARENT_CREATED_SOURCE
//      ('custom') 強制 (trust 境界分離: seed/curriculum を指定できるのは内部 caller のみ)。
//   2. copyFromChild に checkActivityLimit gate (importPackToChildren #2894 と同型)。
//
// **設計判断**: admin-activities-import-plan-gate.test.ts (#2894) と同型。SvelteKit CSRF を
// 回避するため action / endpoint handler を直接呼び出して検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PARENT_CREATED_SOURCE } from '$lib/domain/activity-source';
import { FREE_PLAN_QUOTA } from '$lib/domain/constants/plan-quota';
import { asCategoryId } from '$lib/domain/ids';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import { ACTIVITY_QUOTA_TERMS } from '$lib/domain/terms';

// --- モック ---
const mockRequireTenantId = vi.fn();
const mockResolveFullPlanTier = vi.fn();
const mockCheckActivityLimit = vi.fn();
const mockCreateActivity = vi.fn();
const mockCopyToSibling = vi.fn();
const mockCopyToSiblings = vi.fn();
const mockGetAllChildren = vi.fn();

// #4723: モード判定の実体は auth-mode.ts (factory は re-export)。plan-limit-service など
// 直接 auth-mode を import する側にも同じ値が見えるよう、両方を差し替える。
vi.mock('$lib/server/auth/auth-mode', () => ({
	getAuthMode: vi.fn(() => 'cognito'),
}));

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
	dispatchImport: vi.fn(),
}));

vi.mock('$lib/marketplace/sources/marketplace-source', () => ({
	loadFromMarketplace: vi.fn(),
}));

vi.mock('$lib/marketplace/sources/file-source', () => ({
	FileSourceError: class FileSourceError extends Error {},
	loadActivityPackFromFile: vi.fn(),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: mockGetAllChildren,
}));

vi.mock('$lib/server/services/activity-service', () => ({
	createActivity: mockCreateActivity,
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
	copyChildActivitiesToSibling: mockCopyToSibling,
	copyChildActivitiesToSiblings: mockCopyToSiblings,
}));

// api/v1/activities GET が参照 (POST 経路では未使用)
vi.mock('$lib/server/db/activity-repo', () => ({
	findChildById: vi.fn(async () => undefined),
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

const apiMod = await import('../../../src/routes/api/v1/activities/+server');
const adminMod = await import('../../../src/routes/(parent)/admin/activities/+page.server');

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
	copyResult?: boolean;
	copiedCount?: number;
	/** #4694: 重複 (同名 + 同カテゴリ) で作らなかった件数 */
	skippedCount?: number;
	errorCount?: number;
};

const apiPost = apiMod.POST as unknown as (event: {
	request: Request;
	locals: App.Locals;
}) => Promise<Response>;
const copyFromChildAction = adminMod.actions.copyFromChild as unknown as (event: {
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

function makeJsonRequest(body: Record<string, unknown>): Request {
	return new Request('http://localhost/api/v1/activities', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

function makeFormRequest(fields: Record<string, string | number>): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		form.append(k, String(v));
	}
	return new Request('http://localhost/admin/activities', { method: 'POST', body: form });
}

function validActivityBody(overrides: Record<string, unknown> = {}) {
	return {
		name: 'あたらしい活動',
		categoryId: asCategoryId(1),
		icon: '🏃',
		basePoints: 5,
		ageMin: null,
		ageMax: null,
		...overrides,
	};
}

describe('#3740 quota 残余経路 gate (api/v1 POST + copyFromChild)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireTenantId.mockReturnValue('tenant-1');
		mockGetAllChildren.mockResolvedValue([
			{ id: '902', nickname: 'preschool', tenantId: 'tenant-1' },
			{ id: '903', nickname: 'elementary', tenantId: 'tenant-1' },
		]);
		mockCreateActivity.mockResolvedValue({ id: 'act-1', name: 'あたらしい活動' });
	});

	describe('api/v1/activities POST — checkActivityLimit gate', () => {
		it('free tier が上限到達済みなら 403 PLAN_LIMIT_EXCEEDED を返し createActivity を呼ばない', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			mockCheckActivityLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 });

			const res = await apiPost({
				request: makeJsonRequest(validActivityBody()),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
			expect(body.error.message).toContain('3');
			expect(mockCreateActivity).not.toHaveBeenCalled();
		});

		// #4693 (QM 4 巡目 / #4710 と同 class): 数量制限を **機能ゲートの文型で返さない**。
		// 旧実装は `planLimitError` → 「〜はスタンダードプラン以上でご利用いただけます」を返し、
		// 3 個までは実際に使えるのに「使えません」と言う自己矛盾があった。
		// merge 側 (activities-import-merge-quota-gate.test.ts) と同型の pin をここにも置く。
		it('403 の文言が labels SSOT と一致し、機能ゲートの文型になっていない', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			mockCheckActivityLimit.mockResolvedValue({
				allowed: false,
				current: FREE_PLAN_QUOTA.maxActivities,
				max: FREE_PLAN_QUOTA.maxActivities,
			});

			const res = await apiPost({
				request: makeJsonRequest(validActivityBody()),
				locals: makeLocals({ licenseStatus: 'none' }),
			});
			const body = (await res.json()) as { error: { code: string; message: string } };

			// route が文を組み立てない (ADR-0045 / #4767 の単一チャネル構造)
			expect(body.error.message).toBe(
				PLAN_GATE_LABELS.activityLimitReachedWithUpgrade(FREE_PLAN_QUOTA.maxActivities),
			);
			// #4693 PO 回答 #1 の中身: 数える対象と、数えない経路の両方を言う
			expect(body.error.message).toContain(ACTIVITY_QUOTA_TERMS.original);
			expect(body.error.message).toContain(ACTIVITY_QUOTA_TERMS.presetImport);
			expect(body.error.message).not.toContain('カスタム活動');
			// 導線は本文に載る (REST は message 1 本しか顧客に届かない)
			expect(body.error.message).toContain('アップグレード');
			// 自己矛盾する機能ゲート文型を使わない
			expect(body.error.message).not.toContain('ご利用いただけます');
			// client の分岐条件は変えない
			expect(res.status).toBe(403);
			expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
		});

		it("wire source='seed' 注入で quota gate を回避できない (上限到達時は seed 指定でも 403)", async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			mockCheckActivityLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 });

			const res = await apiPost({
				request: makeJsonRequest(validActivityBody({ source: 'seed' })),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(res.status).toBe(403);
			expect(mockCreateActivity).not.toHaveBeenCalled();
		});

		it('上限未満なら 201 で作成する', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			mockCheckActivityLimit.mockResolvedValue({ allowed: true, current: 1, max: 3 });

			const res = await apiPost({
				request: makeJsonRequest(validActivityBody()),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(res.status).toBe(201);
			expect(mockCreateActivity).toHaveBeenCalledTimes(1);
		});
	});

	describe("api/v1/activities POST — wire source 信頼しない ('custom' 強制、trust 境界分離)", () => {
		beforeEach(() => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			mockCheckActivityLimit.mockResolvedValue({ allowed: true, current: 0, max: 3 });
		});

		it.each([
			'seed',
			'curriculum',
			'parent',
		] as const)("client 供給 source='%s' は persist 前に 'custom' へ強制される", async (wireSource) => {
			const res = await apiPost({
				request: makeJsonRequest(validActivityBody({ source: wireSource })),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(res.status).toBe(201);
			expect(mockCreateActivity).toHaveBeenCalledWith(
				expect.objectContaining({ source: PARENT_CREATED_SOURCE }),
				'tenant-1',
			);
		});

		it("source 未指定も 'custom' で作成される", async () => {
			const res = await apiPost({
				request: makeJsonRequest(validActivityBody()),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(res.status).toBe(201);
			expect(mockCreateActivity).toHaveBeenCalledWith(
				expect.objectContaining({ source: PARENT_CREATED_SOURCE }),
				'tenant-1',
			);
		});
	});

	describe('copyFromChild action — checkActivityLimit gate (#2894 importPack と同型)', () => {
		it('free tier が上限到達済みなら 403 PlanLimitError を返し copy を実行しない', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			mockCheckActivityLimit.mockResolvedValue({ allowed: false, current: 3, max: 3 });

			const result = await copyFromChildAction({
				request: makeFormRequest({ sourceChildId: '902', targetChildId: '903' }),
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
			expect(mockCopyToSibling).not.toHaveBeenCalled();
			expect(mockCopyToSiblings).not.toHaveBeenCalled();
		});

		it('上限未満なら単一 target への copy を実行する', async () => {
			mockResolveFullPlanTier.mockResolvedValue('free');
			mockCheckActivityLimit.mockResolvedValue({ allowed: true, current: 1, max: 3 });
			// #4694: service は { copied, skipped } を返す (重複 skip 件数を UI に出すため)
			mockCopyToSibling.mockResolvedValue({ copied: 2, skipped: 1 });

			const result = await copyFromChildAction({
				request: makeFormRequest({ sourceChildId: '902', targetChildId: '903' }),
				locals: makeLocals({ licenseStatus: 'none' }),
			});

			expect(result.status).toBeUndefined();
			expect(result.copyResult).toBe(true);
			expect(result.copiedCount).toBe(2);
			expect(result.skippedCount).toBe(1);
			expect(mockCopyToSibling).toHaveBeenCalledTimes(1);
		});

		it('paid tier (standard、max=null) は複数 target への copy を実行する', async () => {
			mockResolveFullPlanTier.mockResolvedValue('standard');
			mockCheckActivityLimit.mockResolvedValue({ allowed: true, current: 0, max: null });
			mockCopyToSiblings.mockResolvedValue({ totalCopied: 4, totalSkipped: 0, errors: [] });

			const result = await copyFromChildAction({
				request: makeFormRequest({ sourceChildId: '902', targetChildIds: '903,904' }),
				locals: makeLocals({ licenseStatus: 'active', plan: 'standard_monthly' }),
			});

			expect(result.status).toBeUndefined();
			expect(result.copyResult).toBe(true);
			expect(result.copiedCount).toBe(4);
			expect(mockCopyToSiblings).toHaveBeenCalledTimes(1);
		});
	});
});
