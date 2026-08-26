// tests/unit/routes/admin-activities-per-child-scope.test.ts
// #4692: 活動管理の「選択中の子」と操作対象のズレ (class) の回帰固定。
//
// 実害 (PO 実機観察):
//   - けんたのタブで ︙「バックアップから復元」→ 94 件がたろう (最初の子) に入った (F1)
//   - まさとのタブで ︙「すべて削除」→ 5 人 352 件が消えた (F3)
//
// 本 spec は action handler を直接呼び (SvelteKit CSRF 回避、既存 route unit test と同型)、
//   restore / clearAll が「選択中の子」だけを対象にすることを assert する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireTenantId = vi.fn();
const mockGetAllChildren = vi.fn();
const mockDispatchImport = vi.fn();
const mockLoadActivityPackFromFile = vi.fn();
const mockGetChildActivities = vi.fn();
const mockGetActivities = vi.fn();
const mockHasActivityLogs = vi.fn();
const mockDeleteActivityWithCleanup = vi.fn();
const mockSetActivityVisibility = vi.fn();
const mockLoadFromMarketplace = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: mockRequireTenantId,
	getAuthMode: vi.fn(() => 'cognito'),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: mockGetAllChildren,
}));

vi.mock('$lib/marketplace', () => ({
	dispatchImport: mockDispatchImport,
}));

vi.mock('$lib/marketplace/sources/marketplace-source', () => ({
	loadFromMarketplace: mockLoadFromMarketplace,
}));

vi.mock('$lib/marketplace/sources/file-source', () => ({
	FileSourceError: class FileSourceError extends Error {},
	loadActivityPackFromFile: mockLoadActivityPackFromFile,
}));

vi.mock('$lib/server/services/activity-service', () => ({
	createActivity: vi.fn(),
	deleteActivityWithCleanup: mockDeleteActivityWithCleanup,
	getActivities: mockGetActivities,
	getActivityLogCounts: vi.fn(async () => ({})),
	getChildActivities: mockGetChildActivities,
	getMainQuestCount: vi.fn(async () => 0),
	hasActivityLogs: mockHasActivityLogs,
	MAIN_QUEST_MAX: 3,
	setActivityVisibility: mockSetActivityVisibility,
	setMainQuest: vi.fn(),
	updateActivity: vi.fn(),
}));

vi.mock('$lib/server/services/child-activity-copy-service', () => ({
	copyChildActivitiesToSibling: vi.fn(),
	copyChildActivitiesToSiblings: vi.fn(),
}));

vi.mock('$lib/server/services/plan-limit-service', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/services/plan-limit-service')>(
		'$lib/server/services/plan-limit-service',
	);
	return {
		...actual,
		resolveFullPlanTier: vi.fn(async () => 'family'),
		checkActivityLimit: vi.fn(async () => ({ allowed: true, current: 0, max: null })),
	};
});

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

type ActionResult = {
	status?: number;
	data?: { error?: unknown };
	clearResult?: boolean;
	deleted?: number;
	hidden?: number;
	imported?: number;
};
type ActionFn = (event: { request: Request; locals: App.Locals }) => Promise<ActionResult>;

const importFileAction = mod.actions.importFile as unknown as ActionFn;
const clearAllAction = mod.actions.clearAll as unknown as ActionFn;
const importPackAction = mod.actions.importPack as unknown as ActionFn;

const TARO = '901';
const KENTA = '903';

function makeLocals() {
	return {
		context: { tenantId: 'tenant-1', licenseStatus: 'none' },
	} as unknown as App.Locals;
}

function makeFormRequest(fields: Record<string, string | Blob>): Request {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return new Request('http://localhost/admin/activities', { method: 'POST', body: form });
}

beforeEach(() => {
	vi.clearAllMocks();
	mockRequireTenantId.mockReturnValue('tenant-1');
	mockGetAllChildren.mockResolvedValue([
		{ id: TARO, nickname: 'たろう', tenantId: 'tenant-1' },
		{ id: KENTA, nickname: 'けんた', tenantId: 'tenant-1' },
	]);
	mockDispatchImport.mockResolvedValue({ imported: 2, skipped: 0, errors: [], failed: 0 });
	mockLoadActivityPackFromFile.mockResolvedValue({
		activities: [{ name: 'A' }, { name: 'B' }],
		displayName: 'backup.json',
	});
	mockLoadFromMarketplace.mockReturnValue({
		payload: { activities: [{ name: 'A' }] },
		displayName: 'pack',
	});
	mockGetChildActivities.mockResolvedValue([]);
	mockGetActivities.mockResolvedValue([]);
	mockHasActivityLogs.mockResolvedValue(false);
});

describe('#4692 F1 importFile (バックアップから復元) は選択中の子に入る', () => {
	it('childId で指定した子だけを配信先にする (最初の子に入らない)', async () => {
		const res = await importFileAction({
			request: makeFormRequest({ childId: KENTA, file: new Blob(['{}']) }),
			locals: makeLocals(),
		});

		expect(res.status).toBeUndefined();
		expect(mockDispatchImport).toHaveBeenCalledWith(
			expect.objectContaining({ ctx: expect.objectContaining({ childIds: [KENTA] }) }),
		);
	});

	it('childId 未指定は 400 で拒否する (silent fallback しない)', async () => {
		const res = await importFileAction({
			request: makeFormRequest({ file: new Blob(['{}']) }),
			locals: makeLocals(),
		});

		expect(res.status).toBe(400);
		expect(mockDispatchImport).not.toHaveBeenCalled();
	});

	it('他 tenant / 存在しない childId は 403 で拒否する', async () => {
		const res = await importFileAction({
			request: makeFormRequest({ childId: '99999', file: new Blob(['{}']) }),
			locals: makeLocals(),
		});

		expect(res.status).toBe(403);
		expect(mockDispatchImport).not.toHaveBeenCalled();
	});
});

describe('#4692 F3 clearAll (すべて削除) は選択中の子だけを消す', () => {
	it('選択中の子の活動だけを取得して削除する (tenant 全体を消さない)', async () => {
		mockGetChildActivities.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

		const res = await clearAllAction({
			request: makeFormRequest({ childId: KENTA }),
			locals: makeLocals(),
		});

		expect(mockGetChildActivities).toHaveBeenCalledWith(KENTA, 'tenant-1', {
			includeHidden: true,
		});
		// tenant 全体 aggregate (getActivities) は使わない
		expect(mockGetActivities).not.toHaveBeenCalled();
		expect(mockDeleteActivityWithCleanup).toHaveBeenCalledTimes(2);
		expect(res.deleted).toBe(2);
	});

	it('childId 未指定は 400 で拒否し 1 件も削除しない', async () => {
		const res = await clearAllAction({
			request: makeFormRequest({}),
			locals: makeLocals(),
		});

		expect(res.status).toBe(400);
		expect(mockDeleteActivityWithCleanup).not.toHaveBeenCalled();
		expect(mockSetActivityVisibility).not.toHaveBeenCalled();
	});

	it('他 tenant / 存在しない childId は 403 で拒否する', async () => {
		const res = await clearAllAction({
			request: makeFormRequest({ childId: '99999' }),
			locals: makeLocals(),
		});

		expect(res.status).toBe(403);
		expect(mockDeleteActivityWithCleanup).not.toHaveBeenCalled();
	});
});

describe('#4692 importPack は配信先を明示する', () => {
	it('childIds 未指定なら家族全員に配信する (最初の子だけに入らない)', async () => {
		await importPackAction({
			request: makeFormRequest({ packId: 'kinder-starter' }),
			locals: makeLocals(),
		});

		expect(mockDispatchImport).toHaveBeenCalledWith(
			expect.objectContaining({ ctx: expect.objectContaining({ childIds: [TARO, KENTA] }) }),
		);
	});

	it('childIds を CSV で指定するとその子だけに配信する', async () => {
		await importPackAction({
			request: makeFormRequest({ packId: 'kinder-starter', childIds: KENTA }),
			locals: makeLocals(),
		});

		expect(mockDispatchImport).toHaveBeenCalledWith(
			expect.objectContaining({ ctx: expect.objectContaining({ childIds: [KENTA] }) }),
		);
	});
});
