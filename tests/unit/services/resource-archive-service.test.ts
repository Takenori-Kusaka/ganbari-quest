// tests/unit/services/resource-archive-service.test.ts
// #783: リソース archive / restore サービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック定義 ---
const mockFindAllChildren = vi.fn();
const mockArchiveChildren = vi.fn();
const mockRestoreArchivedChildren = vi.fn();
const mockFindArchivedChildren = vi.fn();
const mockFindActivities = vi.fn();
const mockArchiveActivities = vi.fn();
const mockRestoreArchivedActivities = vi.fn();
const mockFindTemplatesByChild = vi.fn();
const mockArchiveChecklistTemplates = vi.fn();
const mockRestoreArchivedChecklistTemplates = vi.fn();

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
	archiveChildren: (...args: unknown[]) => mockArchiveChildren(...args),
	restoreArchivedChildren: (...args: unknown[]) => mockRestoreArchivedChildren(...args),
	findArchivedChildren: (...args: unknown[]) => mockFindArchivedChildren(...args),
}));

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: (...args: unknown[]) => mockFindActivities(...args),
	archiveActivities: (...args: unknown[]) => mockArchiveActivities(...args),
	restoreArchivedActivities: (...args: unknown[]) => mockRestoreArchivedActivities(...args),
}));

vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplatesByChild: (...args: unknown[]) => mockFindTemplatesByChild(...args),
	archiveChecklistTemplates: (...args: unknown[]) => mockArchiveChecklistTemplates(...args),
	restoreArchivedChecklistTemplates: (...args: unknown[]) =>
		mockRestoreArchivedChecklistTemplates(...args),
}));

import {
	archiveExcessResources,
	getArchivedResourceSummary,
	restoreArchivedResources,
} from '../../../src/lib/server/services/resource-archive-service';

const TENANT = 'test-tenant';

function makeChild(id: number, nickname: string) {
	return {
		id,
		nickname,
		age: 4,
		theme: 'pink',
		uiMode: 'preschool',
		createdAt: '2026-01-01',
		updatedAt: '2026-01-01',
		isArchived: 0,
		archivedReason: null,
	};
}

function makeActivity(id: number, name: string, source = 'custom') {
	return {
		id,
		name,
		categoryId: 1,
		icon: '🏃',
		basePoints: 5,
		source,
		isVisible: 1,
		sortOrder: 0,
		isArchived: 0,
		archivedReason: null,
	};
}

function makeTemplate(id: number, childId: number, name: string) {
	return {
		id,
		childId,
		name,
		icon: '📋',
		pointsPerItem: 2,
		completionBonus: 5,
		isActive: 1,
		isArchived: 0,
		archivedReason: null,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('archiveExcessResources', () => {
	it('free 上限を超える子供を archive する（古い順に残す）', async () => {
		// free: maxChildren=2、子供3人 → id=3 を archive
		mockFindAllChildren.mockResolvedValue([
			makeChild(1, 'たろう'),
			makeChild(2, 'はなこ'),
			makeChild(3, 'じろう'),
		]);
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);
		mockArchiveChildren.mockResolvedValue(undefined);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveChildren).toHaveBeenCalledWith([3], 'trial_expired', TENANT);
		expect(result.archivedChildIds).toEqual([3]);
		expect(result.archivedActivityIds).toEqual([]);
		expect(result.archivedChecklistTemplateIds).toEqual([]);
	});

	it('free 上限を超える custom 活動を archive する', async () => {
		// free: maxActivities=3、custom 5件 → id=4,5 を archive
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう')]);
		mockFindActivities.mockResolvedValue([
			makeActivity(1, '活動1', 'custom'),
			makeActivity(2, '活動2', 'custom'),
			makeActivity(3, '活動3', 'custom'),
			makeActivity(4, '活動4', 'custom'),
			makeActivity(5, '活動5', 'custom'),
		]);
		mockArchiveActivities.mockResolvedValue(undefined);
		mockFindTemplatesByChild.mockResolvedValue([]);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveActivities).toHaveBeenCalledWith([4, 5], 'trial_expired', TENANT);
		expect(result.archivedActivityIds).toEqual([4, 5]);
	});

	it('seed 活動は archive 対象外', async () => {
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう')]);
		mockFindActivities.mockResolvedValue([
			makeActivity(1, 'seed活動1', 'seed'),
			makeActivity(2, 'seed活動2', 'seed'),
			makeActivity(3, 'seed活動3', 'seed'),
			makeActivity(4, 'seed活動4', 'seed'),
			makeActivity(5, 'seed活動5', 'seed'),
		]);
		mockFindTemplatesByChild.mockResolvedValue([]);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveActivities).not.toHaveBeenCalled();
		expect(result.archivedActivityIds).toEqual([]);
	});

	it('free 上限を超えるチェックリストを子供ごとに archive する', async () => {
		// free: maxChecklistTemplates=3、子供1の テンプレート5件 → id=4,5 を archive
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう')]);
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([
			makeTemplate(1, 1, 'テンプレ1'),
			makeTemplate(2, 1, 'テンプレ2'),
			makeTemplate(3, 1, 'テンプレ3'),
			makeTemplate(4, 1, 'テンプレ4'),
			makeTemplate(5, 1, 'テンプレ5'),
		]);
		mockArchiveChecklistTemplates.mockResolvedValue(undefined);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveChecklistTemplates).toHaveBeenCalledWith([4, 5], 'trial_expired', TENANT);
		expect(result.archivedChecklistTemplateIds).toEqual([4, 5]);
	});

	it('上限以内なら何も archive しない', async () => {
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう'), makeChild(2, 'はなこ')]);
		mockFindActivities.mockResolvedValue([
			makeActivity(1, '活動1', 'custom'),
			makeActivity(2, '活動2', 'custom'),
		]);
		mockFindTemplatesByChild.mockResolvedValue([makeTemplate(1, 1, 'テンプレ1')]);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveChildren).not.toHaveBeenCalled();
		expect(mockArchiveActivities).not.toHaveBeenCalled();
		expect(mockArchiveChecklistTemplates).not.toHaveBeenCalled();
		expect(result.archivedChildIds).toEqual([]);
		expect(result.archivedActivityIds).toEqual([]);
		expect(result.archivedChecklistTemplateIds).toEqual([]);
	});

	it('冪等: 既に archive 済みなら何もしない（findAll は非アーカイブのみ返す前提）', async () => {
		// archive 後は findAllChildren が2件以下を返す → archive は実行されない
		mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう'), makeChild(2, 'はなこ')]);
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);

		const result = await archiveExcessResources(TENANT);

		expect(mockArchiveChildren).not.toHaveBeenCalled();
		expect(result.archivedChildIds).toEqual([]);
	});
});

describe('restoreArchivedResources', () => {
	it('trial_expired の全リソースを復元する', async () => {
		mockRestoreArchivedChildren.mockResolvedValue(undefined);
		mockRestoreArchivedActivities.mockResolvedValue(undefined);
		mockRestoreArchivedChecklistTemplates.mockResolvedValue(undefined);

		await restoreArchivedResources(TENANT);

		expect(mockRestoreArchivedChildren).toHaveBeenCalledWith('trial_expired', TENANT);
		expect(mockRestoreArchivedActivities).toHaveBeenCalledWith('trial_expired', TENANT);
		expect(mockRestoreArchivedChecklistTemplates).toHaveBeenCalledWith('trial_expired', TENANT);
	});
});

describe('getArchivedResourceSummary', () => {
	it('archive 済みの子供がいない場合', async () => {
		mockFindArchivedChildren.mockResolvedValue([]);

		const summary = await getArchivedResourceSummary(TENANT);

		expect(summary.archivedChildCount).toBe(0);
		expect(summary.hasArchivedResources).toBe(false);
	});

	it('archive 済みの子供がいる場合', async () => {
		mockFindArchivedChildren.mockResolvedValue([
			{ ...makeChild(3, 'じろう'), isArchived: 1, archivedReason: 'trial_expired' },
		]);

		const summary = await getArchivedResourceSummary(TENANT);

		expect(summary.archivedChildCount).toBe(1);
		expect(summary.hasArchivedResources).toBe(true);
	});
});
