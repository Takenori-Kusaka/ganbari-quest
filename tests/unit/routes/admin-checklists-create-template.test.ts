// tests/unit/routes/admin-checklists-create-template.test.ts
// #723: /admin/checklists の createTemplate action Free プラン上限ガード契約テスト
//
// テスト観点:
// - Free で上限未満 → createTemplate が呼ばれる
// - Free で上限到達 → 403 + upgradeRequired フラグ
// - Standard/Family → 常に通る（max=null）
// - バリデーション (childId/name/timeSlot) は上限チェックより先に走る

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateTemplate = vi.fn();
const mockFindTemplatesByChild = vi.fn();
const mockFindOverrides = vi.fn();
const mockFindTemplateItems = vi.fn();
const mockGetAllChildren = vi.fn();
const mockResolveFullPlanTier = vi.fn();

vi.mock('$lib/server/services/checklist-service', () => ({
	createTemplate: (...args: unknown[]) => mockCreateTemplate(...args),
	editTemplate: vi.fn(),
	removeTemplate: vi.fn(),
	addTemplateItem: vi.fn(),
	removeTemplateItem: vi.fn(),
	addOverride: vi.fn(),
	removeOverride: vi.fn(),
	VALID_TIME_SLOTS: ['morning', 'afternoon', 'evening', 'anytime'],
}));

vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplatesByChild: (...args: unknown[]) => mockFindTemplatesByChild(...args),
	findTemplateItems: (...args: unknown[]) => mockFindTemplateItems(...args),
	findOverrides: (...args: unknown[]) => mockFindOverrides(...args),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));

// plan-limit-service は getRepos().checklist.findTemplatesByChild を通すので、
// そこを mock して上限チェック結果を制御する。
const mockRepoFindTemplatesByChild = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		checklist: { findTemplatesByChild: mockRepoFindTemplatesByChild },
	}),
}));

vi.mock('$lib/server/services/plan-limit-service', async () => {
	// 実装を使いたいが trial-service / auth/factory の副作用を避けたいため、
	// resolveFullPlanTier と isPaidTier / getPlanLimits / checkChecklistTemplateLimit
	// だけ薄く再実装してテスト駆動にする。
	return {
		resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
		isPaidTier: (tier: string) => tier === 'standard' || tier === 'family',
		getPlanLimits: (tier: string) => {
			if (tier === 'free') return { maxChecklistTemplates: 3 };
			return { maxChecklistTemplates: null };
		},
		checkChecklistTemplateLimit: async (
			_tenantId: string,
			_licenseStatus: string,
			childId: number,
		) => {
			const tier = await mockResolveFullPlanTier();
			if (tier !== 'free') return { allowed: true, current: 0, max: null };
			const templates = await mockRepoFindTemplatesByChild(childId, 't-test', true);
			const current = templates.length;
			return { allowed: current < 3, current, max: 3 };
		},
	};
});

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

const { actions } = await import('../../../src/routes/(parent)/admin/checklists/+page.server');

// ---------- Helpers ----------

function createRequest(formValues: Record<string, string>): Request {
	const fd = new FormData();
	for (const [k, v] of Object.entries(formValues)) fd.set(k, v);
	return {
		formData: () => Promise.resolve(fd),
	} as unknown as Request;
}

function createEvent(
	formValues: Record<string, string>,
	options: { tenantId?: string; licenseStatus?: string } = {},
) {
	return {
		request: createRequest(formValues),
		locals: {
			context: {
				tenantId: options.tenantId ?? 't-test',
				licenseStatus: options.licenseStatus ?? 'none',
				role: 'owner',
			},
		},
	} as unknown as Parameters<NonNullable<typeof actions.createTemplate>>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('POST /admin/checklists?/createTemplate (#723)', () => {
	it('Free で 0/3 → createTemplate 呼び出し成功', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		mockRepoFindTemplatesByChild.mockResolvedValue([]);
		mockCreateTemplate.mockResolvedValue({ id: 1 });

		// biome-ignore lint/style/noNonNullAssertion: createTemplate is defined
		const result = await actions.createTemplate!(
			createEvent({ childId: '1', name: 'あさの準備', icon: '☀️', timeSlot: 'morning' }),
		);

		expect(result).toEqual({ success: true });
		expect(mockCreateTemplate).toHaveBeenCalledWith(
			{ childId: 1, name: 'あさの準備', icon: '☀️', timeSlot: 'morning' },
			't-test',
		);
	});

	it('Free で 3/3 到達 → 403 + upgradeRequired（PlanLimitError 形式 #787）', async () => {
		mockResolveFullPlanTier.mockResolvedValue('free');
		mockRepoFindTemplatesByChild.mockResolvedValue([
			{ id: 1, name: 'a' },
			{ id: 2, name: 'b' },
			{ id: 3, name: 'c' },
		]);

		// biome-ignore lint/style/noNonNullAssertion: createTemplate is defined
		const result = (await actions.createTemplate!(
			createEvent({ childId: '1', name: '4つめ', icon: '📋', timeSlot: 'anytime' }),
		)) as {
			status: number;
			data: { error: { code: string; requiredTier: string }; upgradeRequired: boolean };
		};

		expect(result.status).toBe(403);
		expect(result.data.upgradeRequired).toBe(true);
		// #787: PlanLimitError 形式で返る
		expect(result.data.error).toMatchObject({
			code: 'PLAN_LIMIT_EXCEEDED',
			currentTier: 'free',
			requiredTier: 'standard',
			upgradeUrl: '/admin/license',
		});
		expect(mockCreateTemplate).not.toHaveBeenCalled();
	});

	it('Standard は常に通る (上限チェックが max=null で早期リターン)', async () => {
		mockResolveFullPlanTier.mockResolvedValue('standard');
		mockCreateTemplate.mockResolvedValue({ id: 1 });

		// biome-ignore lint/style/noNonNullAssertion: createTemplate is defined
		const result = await actions.createTemplate!(
			createEvent(
				{ childId: '1', name: 'X', icon: '📋', timeSlot: 'anytime' },
				{ licenseStatus: 'active' },
			),
		);

		expect(result).toEqual({ success: true });
		expect(mockRepoFindTemplatesByChild).not.toHaveBeenCalled();
	});

	it('Family も常に通る', async () => {
		mockResolveFullPlanTier.mockResolvedValue('family');
		mockCreateTemplate.mockResolvedValue({ id: 1 });

		// biome-ignore lint/style/noNonNullAssertion: createTemplate is defined
		const result = await actions.createTemplate!(
			createEvent(
				{ childId: '1', name: 'X', icon: '📋', timeSlot: 'anytime' },
				{ licenseStatus: 'active' },
			),
		);

		expect(result).toEqual({ success: true });
	});

	it('childId 未指定 → 400 (バリデーションが上限より先に走る)', async () => {
		// biome-ignore lint/style/noNonNullAssertion: createTemplate is defined
		const result = await actions.createTemplate!(
			createEvent({ childId: '0', name: 'X', icon: '📋', timeSlot: 'anytime' }),
		);

		expect(result).toMatchObject({ status: 400 });
		expect(mockResolveFullPlanTier).not.toHaveBeenCalled();
		expect(mockCreateTemplate).not.toHaveBeenCalled();
	});

	it('name 空 → 400', async () => {
		// biome-ignore lint/style/noNonNullAssertion: createTemplate is defined
		const result = await actions.createTemplate!(
			createEvent({ childId: '1', name: '', icon: '📋', timeSlot: 'anytime' }),
		);

		expect(result).toMatchObject({ status: 400 });
		expect(mockCreateTemplate).not.toHaveBeenCalled();
	});

	it('timeSlot 不正 → 400', async () => {
		// biome-ignore lint/style/noNonNullAssertion: createTemplate is defined
		const result = await actions.createTemplate!(
			createEvent({ childId: '1', name: 'X', icon: '📋', timeSlot: 'invalid' }),
		);

		expect(result).toMatchObject({ status: 400 });
		expect(mockCreateTemplate).not.toHaveBeenCalled();
	});
});
