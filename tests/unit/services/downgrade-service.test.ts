// tests/unit/services/downgrade-service.test.ts
// #738: ダウングレードプレビュー・アーカイブサービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック定義 ---
const mockFindAllChildren = vi.fn();
const mockArchiveChildren = vi.fn();
const mockFindActivities = vi.fn();
const mockArchiveActivities = vi.fn();
const mockFindTemplatesByChild = vi.fn();
const mockArchiveChecklistTemplates = vi.fn();

vi.mock('$lib/server/db/child-repo', () => ({
	findAllChildren: (...args: unknown[]) => mockFindAllChildren(...args),
	archiveChildren: (...args: unknown[]) => mockArchiveChildren(...args),
}));

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: (...args: unknown[]) => mockFindActivities(...args),
	archiveActivities: (...args: unknown[]) => mockArchiveActivities(...args),
}));

vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplatesByChild: (...args: unknown[]) => mockFindTemplatesByChild(...args),
	archiveChecklistTemplates: (...args: unknown[]) => mockArchiveChecklistTemplates(...args),
}));

import {
	archiveForDowngrade,
	getDowngradePreview,
} from '../../../src/lib/server/services/downgrade-service';

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
		pointsPerItem: 5,
		completionBonus: 10,
		timeSlot: 'morning',
		isActive: 1,
		isArchived: 0,
		archivedReason: null,
		createdAt: '2026-01-01',
		updatedAt: '2026-01-01',
	};
}

describe('downgrade-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFindAllChildren.mockResolvedValue([]);
		mockFindActivities.mockResolvedValue([]);
		mockFindTemplatesByChild.mockResolvedValue([]);
		mockArchiveChildren.mockResolvedValue(undefined);
		mockArchiveActivities.mockResolvedValue(undefined);
		mockArchiveChecklistTemplates.mockResolvedValue(undefined);
	});

	describe('getDowngradePreview', () => {
		it('上限以内のリソースでは超過なしと判���する', async () => {
			mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう'), makeChild(2, 'はなこ')]);
			mockFindActivities.mockResolvedValue([
				makeActivity(1, 'ジョギング'),
				makeActivity(2, 'なわとび'),
				makeActivity(3, '読書'),
			]);

			const preview = await getDowngradePreview(TENANT, 'standard', 'free');

			expect(preview.hasExcess).toBe(false);
			expect(preview.children.excess).toBe(0);
			expect(preview.activities.excess).toBe(0);
			expect(preview.targetTier).toBe('free');
		});

		it('子供が free 上限（2人）を超える場合に超過を検出する', async () => {
			mockFindAllChildren.mockResolvedValue([
				makeChild(1, 'たろう'),
				makeChild(2, 'はなこ'),
				makeChild(3, 'じろう'),
			]);
			mockFindActivities.mockResolvedValue([]);

			const preview = await getDowngradePreview(TENANT, 'standard', 'free');

			expect(preview.hasExcess).toBe(true);
			expect(preview.children.excess).toBe(1);
			expect(preview.children.max).toBe(2);
			expect(preview.children.current).toHaveLength(3);
		});

		it('カスタム活動が free 上限（3個）を超える場合に超過を検出する', async () => {
			mockFindAllChildren.mockResolvedValue([]);
			mockFindActivities.mockResolvedValue([
				makeActivity(1, 'ジョギング', 'custom'),
				makeActivity(2, 'なわとび', 'custom'),
				makeActivity(3, '読書', 'custom'),
				makeActivity(4, 'ピアノ', 'custom'),
				makeActivity(5, 'かけっこ', 'seed'), // seed は対象外
			]);

			const preview = await getDowngradePreview(TENANT, 'standard', 'free');

			expect(preview.hasExcess).toBe(true);
			expect(preview.activities.excess).toBe(1);
			expect(preview.activities.max).toBe(3);
			expect(preview.activities.current).toHaveLength(4); // custom のみ
		});

		it('チェックリストテンプレートの子供あたり超過を検出する', async () => {
			const child1 = makeChild(1, 'たろう');
			mockFindAllChildren.mockResolvedValue([child1]);
			mockFindActivities.mockResolvedValue([]);
			mockFindTemplatesByChild.mockResolvedValue([
				makeTemplate(1, 1, '朝のチェック'),
				makeTemplate(2, 1, '昼のチェック'),
				makeTemplate(3, 1, '夜のチェック'),
				makeTemplate(4, 1, '週末チェック'),
			]);

			const preview = await getDowngradePreview(TENANT, 'standard', 'free');

			expect(preview.hasExcess).toBe(true);
			expect(preview.checklistTemplates.excessByChild).toHaveLength(1);
			expect(preview.checklistTemplates.excessByChild[0]?.excess).toBe(1);
		});

		it('履歴保持期間の短縮を検出する（family→free: 無制限→90日）', async () => {
			mockFindAllChildren.mockResolvedValue([]);
			mockFindActivities.mockResolvedValue([]);

			const preview = await getDowngradePreview(TENANT, 'family', 'free');

			expect(preview.retentionChange.willLoseHistory).toBe(true);
			expect(preview.retentionChange.currentDays).toBe(null); // family = 無制限
			expect(preview.retentionChange.targetDays).toBe(90); // free = 90日
		});

		it('standard→free の保持期間変更を検出する（365日→90日）', async () => {
			mockFindAllChildren.mockResolvedValue([]);
			mockFindActivities.mockResolvedValue([]);

			const preview = await getDowngradePreview(TENANT, 'standard', 'free');

			expect(preview.retentionChange.willLoseHistory).toBe(true);
			expect(preview.retentionChange.currentDays).toBe(365);
			expect(preview.retentionChange.targetDays).toBe(90);
		});

		it('同一ティアでは超過も保持変更もなし', async () => {
			mockFindAllChildren.mockResolvedValue([]);
			mockFindActivities.mockResolvedValue([]);

			const preview = await getDowngradePreview(TENANT, 'free', 'free');

			expect(preview.hasExcess).toBe(false);
			expect(preview.retentionChange.willLoseHistory).toBe(false);
		});
	});

	describe('archiveForDowngrade', () => {
		it('選択されたリソースをアーカイブする', async () => {
			mockFindAllChildren.mockResolvedValue([
				makeChild(1, 'たろう'),
				makeChild(2, 'はなこ'),
				makeChild(3, 'じろう'),
			]);
			mockFindActivities.mockResolvedValue([
				makeActivity(1, 'ジョギング'),
				makeActivity(2, 'なわとび'),
				makeActivity(3, '読書'),
				makeActivity(4, 'ピアノ'),
			]);

			const result = await archiveForDowngrade(TENANT, 'free', {
				childIds: [3],
				activityIds: [4],
				checklistTemplateIds: [],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.archivedChildIds).toEqual([3]);
				expect(result.archivedActivityIds).toEqual([4]);
				expect(result.archivedChecklistTemplateIds).toEqual([]);
			}
			expect(mockArchiveChildren).toHaveBeenCalledWith([3], 'downgrade_user_selected', TENANT);
			expect(mockArchiveActivities).toHaveBeenCalledWith([4], 'downgrade_user_selected', TENANT);
		});

		it('アーカイブ後も上限を超える場合はエラーを返す（子供）', async () => {
			mockFindAllChildren.mockResolvedValue([
				makeChild(1, 'たろう'),
				makeChild(2, 'はなこ'),
				makeChild(3, 'じろう'),
				makeChild(4, 'さぶろう'),
			]);
			mockFindActivities.mockResolvedValue([]);

			const result = await archiveForDowngrade(TENANT, 'free', {
				childIds: [3], // 4人→3人、上限2人なのでまだ超過
				activityIds: [],
				checklistTemplateIds: [],
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toContain('子供');
				expect(result.reason).toContain('2人');
			}
		});

		it('アーカイブ後も上限を超える場合はエラーを返す（活動）', async () => {
			mockFindAllChildren.mockResolvedValue([]);
			mockFindActivities.mockResolvedValue([
				makeActivity(1, 'ジョギング'),
				makeActivity(2, 'なわとび'),
				makeActivity(3, '読書'),
				makeActivity(4, 'ピアノ'),
				makeActivity(5, '水泳'),
			]);

			const result = await archiveForDowngrade(TENANT, 'free', {
				childIds: [],
				activityIds: [4], // 5個→4個、上限3個なのでまだ超過
				checklistTemplateIds: [],
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.reason).toContain('活動');
				expect(result.reason).toContain('3個');
			}
		});

		it('選択なしの場合はアーカイブ関数を呼び出さない', async () => {
			mockFindAllChildren.mockResolvedValue([makeChild(1, 'たろう')]);
			mockFindActivities.mockResolvedValue([makeActivity(1, 'ジョギング')]);

			const result = await archiveForDowngrade(TENANT, 'free', {
				childIds: [],
				activityIds: [],
				checklistTemplateIds: [],
			});

			expect(result.ok).toBe(true);
			expect(mockArchiveChildren).not.toHaveBeenCalled();
			expect(mockArchiveActivities).not.toHaveBeenCalled();
			expect(mockArchiveChecklistTemplates).not.toHaveBeenCalled();
		});

		it('アーカイブ対象の子供のチェックリストテンプレートは検証をスキップする', async () => {
			mockFindAllChildren.mockResolvedValue([
				makeChild(1, 'たろう'),
				makeChild(2, 'はなこ'),
				makeChild(3, 'じろう'),
			]);
			mockFindActivities.mockResolvedValue([]);
			// child 3 は 5 テンプレある（上限 3）が、child 自体をアーカイブ
			mockFindTemplatesByChild.mockImplementation((childId: number) => {
				if (childId === 3) {
					return Promise.resolve([
						makeTemplate(10, 3, 'A'),
						makeTemplate(11, 3, 'B'),
						makeTemplate(12, 3, 'C'),
						makeTemplate(13, 3, 'D'),
						makeTemplate(14, 3, 'E'),
					]);
				}
				return Promise.resolve([]);
			});

			const result = await archiveForDowngrade(TENANT, 'free', {
				childIds: [3], // child 3 をアーカイブ → テンプレ検証をスキップ
				activityIds: [],
				checklistTemplateIds: [],
			});

			expect(result.ok).toBe(true);
		});
	});
});
