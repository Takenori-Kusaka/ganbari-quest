// tests/unit/routes/admin-checklists-import-partial-skip.test.ts (#4693 AC4)
//
// チェックリスト取込の上限エラーは **誰の上限か**を言い、**余裕のある子には配信する**。
//
// 旧実装は「1 人でも上限超過なら全員分を fail」+ 文言に子の名前が無かったため、
// 「フリープランではお子さま1人あたり 3 個までです」だけが出て、
// (a) どの子が上限なのか分からず (b) 空きのある子にも取り込まれない、の 2 重の詰まりだった。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildId } from '$lib/domain/ids';
import { asChildId } from '$lib/domain/ids';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockResolveFullPlanTier = vi.fn();
const mockGetAllChildren = vi.fn();
const mockDispatchImport = vi.fn();
const mockRepoFindTemplatesByChild = vi.fn();

vi.mock('$lib/server/services/checklist-service', () => ({
	createTemplate: vi.fn(),
	editTemplate: vi.fn(),
	removeTemplate: vi.fn(),
	addTemplateItem: vi.fn(),
	removeTemplateItem: vi.fn(),
	addOverride: vi.fn(),
	removeOverride: vi.fn(),
	VALID_TIME_SLOTS: ['morning', 'afternoon', 'evening', 'anytime'],
}));

vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplatesByChild: vi.fn(),
	findTemplateItems: vi.fn(),
	findOverrides: vi.fn(),
	findAssignmentsByChild: vi.fn(),
	findAssignmentsByTemplate: vi.fn(),
	findTodayLog: vi.fn(),
	findTemplatesByTenant: vi.fn(),
}));

vi.mock('$lib/server/services/checklist-distribution-service', () => ({
	distributeToChildren: vi.fn(),
	syncDistribution: vi.fn(),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		checklist: { findTemplatesByChild: mockRepoFindTemplatesByChild },
	}),
}));

const FREE_MAX = 3;
vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: (...args: unknown[]) => mockResolveFullPlanTier(...args),
	isPaidTier: (tier: string) => tier === 'standard' || tier === 'family',
	getPlanLimits: (tier: string) =>
		tier === 'free' ? { maxChecklistTemplates: FREE_MAX } : { maxChecklistTemplates: null },
	checkChecklistTemplateLimit: async (
		_tenantId: string,
		_licenseStatus: string,
		childId: ChildId,
	) => {
		const tier = await mockResolveFullPlanTier();
		if (tier !== 'free') return { allowed: true, current: 0, max: null };
		const templates = await mockRepoFindTemplatesByChild(childId, 't-test', true);
		const current = templates.length;
		return { allowed: current < FREE_MAX, current, max: FREE_MAX };
	},
}));

vi.mock('$lib/marketplace', () => ({
	dispatchImport: (...args: unknown[]) => mockDispatchImport(...args),
}));

vi.mock('$lib/data/marketplace', () => ({
	getMarketplaceItem: (type: string, id: string) =>
		type === 'checklist' && id === 'event-pool'
			? { itemId: id, name: 'プール', payload: { items: [] } }
			: null,
}));

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

const { actions } = await import('../../../src/routes/(parent)/admin/checklists/+page.server');
// SvelteKit の Actions 型は optional を含むため、テスト用に non-null 化する
// (他の admin action テストと同型: tests/unit/routes/admin-rewards-actions.test.ts)。
const importPresetToChildren = actions.importPresetToChildren as unknown as (
	event: unknown,
) => Promise<{ status?: number; data?: { error?: { message: string } }; errors?: string[] }>;

const FULL = asChildId(1); // 上限に達している子
const ROOM = asChildId(2); // 空きのある子

function event(childIds: string) {
	const fd = new FormData();
	fd.set('presetId', 'event-pool');
	fd.set('childIds', childIds);
	return {
		request: { formData: () => Promise.resolve(fd) } as unknown as Request,
		locals: { context: { tenantId: 't-test', licenseStatus: 'none', role: 'owner' } },
		// biome-ignore lint/suspicious/noExplicitAny: minimal RequestEvent stub for action unit test
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockResolveFullPlanTier.mockResolvedValue('free');
	mockGetAllChildren.mockResolvedValue([
		{ id: FULL, nickname: 'たろう' },
		{ id: ROOM, nickname: 'はなこ' },
	]);
	mockRepoFindTemplatesByChild.mockImplementation(async (childId: ChildId) =>
		childId === FULL ? [{}, {}, {}] : [{}],
	);
	mockDispatchImport.mockResolvedValue({
		packName: 'プール',
		imported: 1,
		skipped: 0,
		total: 1,
		errors: [],
	});
});

describe('#4693 チェックリスト取込の上限は「誰が」を言い、余裕のある子には配信する', () => {
	it('一部の子だけ上限 → 余裕のある子に配信し、スキップした子の名前を返す', async () => {
		const result = await importPresetToChildren(event(`${FULL},${ROOM}`));

		// 配信先から上限の子だけが外れている
		expect(mockDispatchImport).toHaveBeenCalledWith(
			expect.objectContaining({ ctx: expect.objectContaining({ childIds: [ROOM] }) }),
		);
		const errors = (result as { errors: string[] }).errors.join(' ');
		expect(errors).toContain('たろう');
		expect(errors).not.toContain('はなこ');
	});

	it('全員が上限 → 403 で拒否し、エラー文に対象の子が並ぶ', async () => {
		mockRepoFindTemplatesByChild.mockResolvedValue([{}, {}, {}]);

		const result = (await importPresetToChildren(event(`${FULL},${ROOM}`))) as {
			status: number;
			data: { error: { message: string } };
		};

		expect(result.status).toBe(403);
		expect(result.data.error.message).toContain('たろう');
		expect(result.data.error.message).toContain('はなこ');
		expect(mockDispatchImport).not.toHaveBeenCalled();
	});

	it('有料プランは上限判定で外れない', async () => {
		mockResolveFullPlanTier.mockResolvedValue('standard');

		await importPresetToChildren(event(`${FULL},${ROOM}`));

		expect(mockDispatchImport).toHaveBeenCalledWith(
			expect.objectContaining({ ctx: expect.objectContaining({ childIds: [FULL, ROOM] }) }),
		);
	});
});
