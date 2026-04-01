// tests/unit/services/import-service.test.ts
// データインポートサービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks ----------

const mockFindActivities = vi.fn();
const mockInsertActivity = vi.fn();
const mockInsertActivityLog = vi.fn();
const mockInsertPointLedger = vi.fn();
const mockInsertChild = vi.fn();
const mockUpsertStatus = vi.fn();
const mockInsertStatusHistory = vi.fn();
const mockFindAllAchievements = vi.fn();
const mockInsertChildAchievement = vi.fn();
const mockFindAllTitles = vi.fn();
const mockInsertChildTitle = vi.fn();
const mockInsertLoginBonus = vi.fn();
const mockInsertTemplate = vi.fn();
const mockInsertTemplateItem = vi.fn();

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: (...args: unknown[]) => mockFindActivities(...args),
	insertActivity: (...args: unknown[]) => mockInsertActivity(...args),
	insertActivityLog: (...args: unknown[]) => mockInsertActivityLog(...args),
	insertPointLedger: (...args: unknown[]) => mockInsertPointLedger(...args),
}));

vi.mock('$lib/server/db/child-repo', () => ({
	insertChild: (...args: unknown[]) => mockInsertChild(...args),
}));

vi.mock('$lib/server/db/status-repo', () => ({
	upsertStatus: (...args: unknown[]) => mockUpsertStatus(...args),
	insertStatusHistory: (...args: unknown[]) => mockInsertStatusHistory(...args),
}));

vi.mock('$lib/server/db/achievement-repo', () => ({
	findAllAchievements: (...args: unknown[]) => mockFindAllAchievements(...args),
	insertChildAchievement: (...args: unknown[]) => mockInsertChildAchievement(...args),
}));

vi.mock('$lib/server/db/title-repo', () => ({
	findAllTitles: (...args: unknown[]) => mockFindAllTitles(...args),
	insertChildTitle: (...args: unknown[]) => mockInsertChildTitle(...args),
}));

vi.mock('$lib/server/db/login-bonus-repo', () => ({
	insertLoginBonus: (...args: unknown[]) => mockInsertLoginBonus(...args),
}));

vi.mock('$lib/server/db/checklist-repo', () => ({
	insertTemplate: (...args: unknown[]) => mockInsertTemplate(...args),
	insertTemplateItem: (...args: unknown[]) => mockInsertTemplateItem(...args),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/domain/validation/activity', () => ({
	CATEGORY_CODES: ['undou', 'benkyou', 'seikatsu', 'kouryuu', 'souzou'],
}));

// ---------- Import after mocks ----------

import type { ExportData } from '../../../src/lib/domain/export-format';
import {
	importFamilyData,
	previewImport,
	validateExportData,
} from '../../../src/lib/server/services/import-service';

// ---------- Helpers ----------

const TENANT = 'test-tenant-001';

function makeExportData(overrides: Partial<ExportData> = {}): ExportData {
	return {
		format: 'ganbari-quest-backup',
		version: '1.1.0',
		exportedAt: new Date().toISOString(),
		checksum: 'test-checksum',
		master: {
			categories: [],
			activities: [],
			titles: [],
			achievements: [],
			avatarItems: [],
		},
		family: {
			children: [],
		},
		data: {
			activityLogs: [],
			pointLedger: [],
			statuses: [],
			statusHistory: [],
			childAchievements: [],
			childTitles: [],
			loginBonuses: [],
			evaluations: [],
			specialRewards: [],
			checklistTemplates: [],
			checklistLogs: [],
			childAvatarItems: [],
			dailyMissions: [],
		},
		...overrides,
	} as ExportData;
}

function makeChild(exportId: string, nickname = 'テスト太郎') {
	return {
		exportId,
		nickname,
		age: 5,
		birthDate: '2021-01-15',
		theme: 'blue',
		uiMode: 'kinder',
		avatarUrl: null,
		activeTitle: null,
		createdAt: '2025-06-01T00:00:00Z',
	};
}

// ---------- Reset ----------

beforeEach(() => {
	vi.clearAllMocks();

	// Default: lookup mocks return empty arrays
	mockFindActivities.mockResolvedValue([]);
	mockFindAllTitles.mockResolvedValue([]);
	mockFindAllAchievements.mockResolvedValue([]);
});

// ============================================================
// validateExportData
// ============================================================

describe('validateExportData', () => {
	it('null を渡すと invalid を返す', () => {
		const result = validateExportData(null);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('JSONオブジェクト');
		}
	});

	it('undefined を渡すと invalid を返す', () => {
		const result = validateExportData(undefined);
		expect(result.valid).toBe(false);
	});

	it('文字列を渡すと invalid を返す', () => {
		const result = validateExportData('not-an-object');
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('JSONオブジェクト');
		}
	});

	it('数値を渡すと invalid を返す', () => {
		const result = validateExportData(42);
		expect(result.valid).toBe(false);
	});

	it('空配列を渡すと format 不正エラーになる', () => {
		// Array is typeof 'object' and truthy, so passes first check
		const result = validateExportData([]);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('フォーマット');
		}
	});

	it('format が不正な場合は期待されるフォーマット名を含むエラーを返す', () => {
		const result = validateExportData({ format: 'wrong-format' });
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('ganbari-quest-backup');
		}
	});

	it('version が不正な場合は対応バージョンを含むエラーを返す', () => {
		const result = validateExportData({
			format: 'ganbari-quest-backup',
			version: '2.0.0',
		});
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('1.1.0');
			expect(result.error).toContain('1.0.0');
			expect(result.error).toContain('2.0.0');
		}
	});

	it('version 1.0.0 は受け入れられる', () => {
		const data = makeExportData({ version: '1.0.0' });
		// Need children to pass validation
		data.family.children = [makeChild('c1')];
		const result = validateExportData(data);
		expect(result.valid).toBe(true);
	});

	it('family が存在しない場合は invalid を返す', () => {
		const result = validateExportData({
			format: 'ganbari-quest-backup',
			version: '1.1.0',
		});
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('family');
		}
	});

	it('family.children が空配列の場合は invalid を返す', () => {
		const result = validateExportData({
			format: 'ganbari-quest-backup',
			version: '1.1.0',
			family: { children: [] },
		});
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('子供データ');
		}
	});

	it('data セクションが存在しない場合は invalid を返す', () => {
		const result = validateExportData({
			format: 'ganbari-quest-backup',
			version: '1.1.0',
			family: { children: [makeChild('c1')] },
		});
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain('data セクション');
		}
	});

	it('完全な有効データを渡すと valid: true と data を返す', () => {
		const exportData = makeExportData();
		exportData.family.children = [makeChild('c1')];
		const result = validateExportData(exportData);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.data).toEqual(exportData);
		}
	});
});

// ============================================================
// previewImport
// ============================================================

describe('previewImport', () => {
	it('各データセクションの件数を正しく返す', () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1'), makeChild('c2', 'テスト花子')];
		data.data.activityLogs = [
			{
				childRef: 'c1',
				activityName: 'テスト活動',
				activityCategory: 'undou',
				points: 10,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-15',
				recordedAt: '2026-03-15T08:30:00Z',
				cancelled: false,
			},
		];
		data.data.pointLedger = [
			{
				childRef: 'c1',
				amount: 10,
				type: 'earn',
				description: 'テスト',
				createdAt: '2026-03-15T08:30:00Z',
			},
			{
				childRef: 'c1',
				amount: 5,
				type: 'earn',
				description: 'テスト2',
				createdAt: '2026-03-15T09:00:00Z',
			},
		];
		data.data.statuses = [
			{
				childRef: 'c1',
				categoryCode: 'undou',
				totalXp: 100,
				level: 5,
				peakXp: 100,
				updatedAt: '2026-03-15T08:30:00Z',
			},
		];
		data.data.childAchievements = [
			{
				childRef: 'c1',
				achievementCode: 'first_step',
				milestoneValue: null,
				unlockedAt: '2026-03-10T00:00:00Z',
			},
		];
		data.data.childTitles = [
			{
				childRef: 'c1',
				titleCode: 'undou_master',
				unlockedAt: '2026-03-12T00:00:00Z',
			},
		];
		data.data.loginBonuses = [
			{
				childRef: 'c1',
				loginDate: '2026-03-15',
				rank: 'gold',
				basePoints: 5,
				multiplier: 1.5,
				totalPoints: 8,
				consecutiveDays: 3,
				createdAt: '2026-03-15T00:00:00Z',
			},
			{
				childRef: 'c1',
				loginDate: '2026-03-16',
				rank: 'silver',
				basePoints: 3,
				multiplier: 1.0,
				totalPoints: 3,
				consecutiveDays: 4,
				createdAt: '2026-03-16T00:00:00Z',
			},
		];
		data.data.checklistTemplates = [
			{
				childRef: 'c1',
				name: 'あさのしたく',
				icon: '🌅',
				pointsPerItem: 2,
				completionBonus: 5,
				isActive: true,
				items: [],
			},
		];

		const preview = previewImport(data);

		expect(preview.children).toBe(2);
		expect(preview.activityLogs).toBe(1);
		expect(preview.pointLedger).toBe(2);
		expect(preview.statuses).toBe(1);
		expect(preview.achievements).toBe(1);
		expect(preview.titles).toBe(1);
		expect(preview.loginBonuses).toBe(2);
		expect(preview.checklistTemplates).toBe(1);
	});

	it('空の配列の場合は全てゼロを返す', () => {
		const data = makeExportData();
		const preview = previewImport(data);

		expect(preview.children).toBe(0);
		expect(preview.activityLogs).toBe(0);
		expect(preview.pointLedger).toBe(0);
		expect(preview.statuses).toBe(0);
		expect(preview.achievements).toBe(0);
		expect(preview.titles).toBe(0);
		expect(preview.loginBonuses).toBe(0);
		expect(preview.checklistTemplates).toBe(0);
	});
});

// ============================================================
// importFamilyData
// ============================================================

describe('importFamilyData', () => {
	describe('空データのインポート', () => {
		it('子供なし・ログなしの場合は全カウントがゼロになる', async () => {
			const data = makeExportData();
			const result = await importFamilyData(data, TENANT);

			expect(result.childrenImported).toBe(0);
			expect(result.activitiesCreated).toBe(0);
			expect(result.activityLogsImported).toBe(0);
			expect(result.activityLogsSkipped).toBe(0);
			expect(result.pointLedgerImported).toBe(0);
			expect(result.pointLedgerSkipped).toBe(0);
			expect(result.statusesImported).toBe(0);
			expect(result.achievementsImported).toBe(0);
			expect(result.titlesImported).toBe(0);
			expect(result.errors).toContain('子供の作成が全て失敗しました');
		});
	});

	describe('子供の作成', () => {
		it('子供の作成に成功するとカウントが増える', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1'), makeChild('c2', 'テスト花子')];

			mockInsertChild.mockResolvedValueOnce({ id: 101 }).mockResolvedValueOnce({ id: 102 });

			const result = await importFamilyData(data, TENANT);

			expect(result.childrenImported).toBe(2);
			expect(result.errors).toHaveLength(0);
			expect(mockInsertChild).toHaveBeenCalledTimes(2);
			expect(mockInsertChild).toHaveBeenCalledWith(
				expect.objectContaining({ nickname: 'テスト太郎', age: 5 }),
				TENANT,
			);
		});

		it('子供の作成が全て失敗すると早期リターンする', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.activityLogs = [
				{
					childRef: 'c1',
					activityName: 'テスト',
					activityCategory: 'undou',
					points: 10,
					streakDays: 1,
					streakBonus: 0,
					recordedDate: '2026-03-15',
					recordedAt: '2026-03-15T08:30:00Z',
					cancelled: false,
				},
			];

			mockInsertChild.mockRejectedValue(new Error('DB error'));

			const result = await importFamilyData(data, TENANT);

			expect(result.childrenImported).toBe(0);
			expect(result.errors).toContain('子供「テスト太郎」の作成に失敗: Error: DB error');
			expect(result.errors).toContain('子供の作成が全て失敗しました');
			// Activity log import should not have been attempted
			expect(mockInsertActivityLog).not.toHaveBeenCalled();
		});

		it('一部の子供の作成に失敗してもインポートは続行される', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1'), makeChild('c2', 'テスト花子')];

			mockInsertChild
				.mockRejectedValueOnce(new Error('duplicate'))
				.mockResolvedValueOnce({ id: 102 });

			const result = await importFamilyData(data, TENANT);

			expect(result.childrenImported).toBe(1);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain('テスト太郎');
		});
	});

	describe('活動マスタのインポート', () => {
		it('既存活動と重複しない場合は新規作成される', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.master.activities = [
				{
					name: '新しい活動',
					categoryCode: 'undou',
					icon: '🏃',
					basePoints: 10,
					gradeLevel: null,
					nameKana: null,
					nameKanji: null,
					triggerHint: null,
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindActivities.mockResolvedValue([]);
			mockInsertActivity.mockResolvedValue({ id: 1 });

			const result = await importFamilyData(data, TENANT);

			expect(result.activitiesCreated).toBe(1);
			expect(mockInsertActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					name: '新しい活動',
					categoryId: 1, // undou = 1
					icon: '🏃',
					basePoints: 10,
				}),
				TENANT,
			);
		});

		it('既存活動と名前が重複する場合はスキップされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.master.activities = [
				{
					name: '既存の活動',
					categoryCode: 'undou',
					icon: '🏃',
					basePoints: 10,
					gradeLevel: null,
					nameKana: null,
					nameKanji: null,
					triggerHint: null,
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			// First call for master import, second for lookup building
			mockFindActivities.mockResolvedValue([{ name: '既存の活動', id: 1 }]);

			const result = await importFamilyData(data, TENANT);

			expect(result.activitiesCreated).toBe(0);
			expect(mockInsertActivity).not.toHaveBeenCalled();
		});

		it('不明なカテゴリコードの場合は警告が追加される', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.master.activities = [
				{
					name: '不明カテゴリ活動',
					categoryCode: 'unknown_category',
					icon: '❓',
					basePoints: 5,
					gradeLevel: null,
					nameKana: null,
					nameKanji: null,
					triggerHint: null,
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindActivities.mockResolvedValue([]);

			const result = await importFamilyData(data, TENANT);

			expect(result.activitiesCreated).toBe(0);
			expect(result.warnings).toEqual(
				expect.arrayContaining([expect.stringContaining('unknown_category')]),
			);
		});

		it('活動の作成失敗時は警告が追加される', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.master.activities = [
				{
					name: '失敗する活動',
					categoryCode: 'benkyou',
					icon: '📚',
					basePoints: 8,
					gradeLevel: null,
					nameKana: null,
					nameKanji: null,
					triggerHint: null,
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindActivities.mockResolvedValue([]);
			mockInsertActivity.mockRejectedValue(new Error('constraint violation'));

			const result = await importFamilyData(data, TENANT);

			expect(result.activitiesCreated).toBe(0);
			expect(result.warnings).toEqual(
				expect.arrayContaining([expect.stringContaining('失敗する活動')]),
			);
		});
	});

	describe('活動ログのインポート', () => {
		it('マスタに存在する活動のログが正常にインポートされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.activityLogs = [
				{
					childRef: 'c1',
					activityName: 'テスト活動',
					activityCategory: 'undou',
					points: 10,
					streakDays: 3,
					streakBonus: 2,
					recordedDate: '2026-03-15',
					recordedAt: '2026-03-15T08:30:00Z',
					cancelled: false,
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindActivities.mockResolvedValue([{ name: 'テスト活動', id: 5 }]);
			mockInsertActivityLog.mockResolvedValue({});

			const result = await importFamilyData(data, TENANT);

			expect(result.activityLogsImported).toBe(1);
			expect(result.activityLogsSkipped).toBe(0);
			expect(mockInsertActivityLog).toHaveBeenCalledWith(
				expect.objectContaining({
					childId: 101,
					activityId: 5,
					points: 10,
					streakDays: 3,
					streakBonus: 2,
				}),
				TENANT,
			);
		});

		it('マスタに存在しない活動名のログはスキップされ警告が追加される', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.activityLogs = [
				{
					childRef: 'c1',
					activityName: '存在しない活動',
					activityCategory: 'undou',
					points: 10,
					streakDays: 1,
					streakBonus: 0,
					recordedDate: '2026-03-15',
					recordedAt: '2026-03-15T08:30:00Z',
					cancelled: false,
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindActivities.mockResolvedValue([]);

			const result = await importFamilyData(data, TENANT);

			expect(result.activityLogsSkipped).toBe(1);
			expect(result.activityLogsImported).toBe(0);
			expect(result.warnings).toEqual(
				expect.arrayContaining([expect.stringContaining('存在しない活動')]),
			);
		});

		it('同じ不明活動名の警告は重複しない', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			const logEntry = {
				childRef: 'c1' as const,
				activityName: '消えた活動',
				activityCategory: 'undou',
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-15',
				recordedAt: '2026-03-15T08:30:00Z',
				cancelled: false,
			};
			data.data.activityLogs = [logEntry, { ...logEntry, recordedDate: '2026-03-16' }];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindActivities.mockResolvedValue([]);

			const result = await importFamilyData(data, TENANT);

			expect(result.activityLogsSkipped).toBe(2);
			const matchingWarnings = result.warnings.filter((w) => w.includes('消えた活動'));
			expect(matchingWarnings).toHaveLength(1);
		});

		it('childRef がマッピングに存在しないログはスキップされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.activityLogs = [
				{
					childRef: 'nonexistent',
					activityName: 'テスト活動',
					activityCategory: 'undou',
					points: 10,
					streakDays: 1,
					streakBonus: 0,
					recordedDate: '2026-03-15',
					recordedAt: '2026-03-15T08:30:00Z',
					cancelled: false,
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindActivities.mockResolvedValue([{ name: 'テスト活動', id: 5 }]);

			const result = await importFamilyData(data, TENANT);

			expect(result.activityLogsImported).toBe(0);
			expect(mockInsertActivityLog).not.toHaveBeenCalled();
		});
	});

	describe('ポイント台帳のインポート', () => {
		it('正常にインポートされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.pointLedger = [
				{
					childRef: 'c1',
					amount: 10,
					type: 'earn',
					description: 'テスト報酬',
					createdAt: '2026-03-15T08:30:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockInsertPointLedger.mockResolvedValue({});

			const result = await importFamilyData(data, TENANT);

			expect(result.pointLedgerImported).toBe(1);
			expect(result.pointLedgerSkipped).toBe(0);
			expect(mockInsertPointLedger).toHaveBeenCalledWith(
				expect.objectContaining({
					childId: 101,
					amount: 10,
					type: 'earn',
					description: 'テスト報酬',
				}),
				TENANT,
			);
		});

		it('description が null の場合は空文字列に変換される', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.pointLedger = [
				{
					childRef: 'c1',
					amount: 5,
					type: 'earn',
					description: null,
					createdAt: '2026-03-15T08:30:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockInsertPointLedger.mockResolvedValue({});

			const result = await importFamilyData(data, TENANT);

			expect(result.pointLedgerImported).toBe(1);
			expect(mockInsertPointLedger).toHaveBeenCalledWith(
				expect.objectContaining({ description: '' }),
				TENANT,
			);
		});

		it('childRef が不明な場合はスキップされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.pointLedger = [
				{
					childRef: 'unknown',
					amount: 10,
					type: 'earn',
					description: null,
					createdAt: '2026-03-15T08:30:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });

			const result = await importFamilyData(data, TENANT);

			expect(result.pointLedgerSkipped).toBe(1);
			expect(result.pointLedgerImported).toBe(0);
		});

		it('挿入失敗時はスキップカウントが増える', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.pointLedger = [
				{
					childRef: 'c1',
					amount: 10,
					type: 'earn',
					description: 'テスト',
					createdAt: '2026-03-15T08:30:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockInsertPointLedger.mockRejectedValue(new Error('duplicate'));

			const result = await importFamilyData(data, TENANT);

			expect(result.pointLedgerImported).toBe(0);
			expect(result.pointLedgerSkipped).toBe(1);
		});
	});

	describe('ステータスのインポート', () => {
		it('正常にインポートされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.statuses = [
				{
					childRef: 'c1',
					categoryCode: 'undou',
					totalXp: 100,
					level: 5,
					peakXp: 120,
					updatedAt: '2026-03-15T08:30:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockUpsertStatus.mockResolvedValue({});

			const result = await importFamilyData(data, TENANT);

			expect(result.statusesImported).toBe(1);
			expect(mockUpsertStatus).toHaveBeenCalledWith(101, 1, 100, 5, 120, TENANT);
		});

		it('不明なカテゴリコードのステータスはスキップされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.statuses = [
				{
					childRef: 'c1',
					categoryCode: 'invalid',
					totalXp: 50,
					level: 2,
					peakXp: 50,
					updatedAt: '2026-03-15T08:30:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });

			const result = await importFamilyData(data, TENANT);

			expect(result.statusesImported).toBe(0);
			expect(mockUpsertStatus).not.toHaveBeenCalled();
		});

		it('upsertStatus の失敗時はエラーが追加される', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.statuses = [
				{
					childRef: 'c1',
					categoryCode: 'benkyou',
					totalXp: 200,
					level: 10,
					peakXp: 200,
					updatedAt: '2026-03-15T08:30:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockUpsertStatus.mockRejectedValue(new Error('DB failure'));

			const result = await importFamilyData(data, TENANT);

			expect(result.statusesImported).toBe(0);
			expect(result.errors).toEqual(
				expect.arrayContaining([expect.stringContaining('ステータスインポート失敗')]),
			);
		});
	});

	describe('実績のインポート', () => {
		it('マスタに存在する実績コードが正常にインポートされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.childAchievements = [
				{
					childRef: 'c1',
					achievementCode: 'first_step',
					milestoneValue: null,
					unlockedAt: '2026-03-10T00:00:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindAllAchievements.mockResolvedValue([{ id: 10, code: 'first_step' }]);
			mockInsertChildAchievement.mockResolvedValue({});

			const result = await importFamilyData(data, TENANT);

			expect(result.achievementsImported).toBe(1);
			expect(mockInsertChildAchievement).toHaveBeenCalledWith(101, 10, TENANT, null);
		});

		it('マスタに存在しない実績コードはスキップされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.childAchievements = [
				{
					childRef: 'c1',
					achievementCode: 'nonexistent_achievement',
					milestoneValue: null,
					unlockedAt: '2026-03-10T00:00:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindAllAchievements.mockResolvedValue([]);

			const result = await importFamilyData(data, TENANT);

			expect(result.achievementsImported).toBe(0);
			expect(mockInsertChildAchievement).not.toHaveBeenCalled();
		});

		it('milestoneValue が渡される', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.childAchievements = [
				{
					childRef: 'c1',
					achievementCode: 'milestone_100',
					milestoneValue: 100,
					unlockedAt: '2026-03-10T00:00:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindAllAchievements.mockResolvedValue([{ id: 20, code: 'milestone_100' }]);
			mockInsertChildAchievement.mockResolvedValue({});

			const result = await importFamilyData(data, TENANT);

			expect(result.achievementsImported).toBe(1);
			expect(mockInsertChildAchievement).toHaveBeenCalledWith(101, 20, TENANT, 100);
		});
	});

	describe('称号のインポート', () => {
		it('マスタに存在する称号コードが正常にインポートされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.childTitles = [
				{
					childRef: 'c1',
					titleCode: 'undou_master',
					unlockedAt: '2026-03-12T00:00:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindAllTitles.mockResolvedValue([{ id: 30, code: 'undou_master' }]);
			mockInsertChildTitle.mockResolvedValue({});

			const result = await importFamilyData(data, TENANT);

			expect(result.titlesImported).toBe(1);
			expect(mockInsertChildTitle).toHaveBeenCalledWith(101, 30, TENANT);
		});

		it('マスタに存在しない称号コードはスキップされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.childTitles = [
				{
					childRef: 'c1',
					titleCode: 'nonexistent_title',
					unlockedAt: '2026-03-12T00:00:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockFindAllTitles.mockResolvedValue([]);

			const result = await importFamilyData(data, TENANT);

			expect(result.titlesImported).toBe(0);
			expect(mockInsertChildTitle).not.toHaveBeenCalled();
		});
	});

	describe('ログインボーナスのインポート', () => {
		it('正常にインポートされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.loginBonuses = [
				{
					childRef: 'c1',
					loginDate: '2026-03-15',
					rank: 'gold',
					basePoints: 5,
					multiplier: 1.5,
					totalPoints: 8,
					consecutiveDays: 3,
					createdAt: '2026-03-15T00:00:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockInsertLoginBonus.mockResolvedValue({});

			await importFamilyData(data, TENANT);

			expect(mockInsertLoginBonus).toHaveBeenCalledWith(
				expect.objectContaining({
					childId: 101,
					loginDate: '2026-03-15',
					rank: 'gold',
					consecutiveDays: 3,
				}),
				TENANT,
			);
		});

		it('childRef が不明な場合はスキップされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.loginBonuses = [
				{
					childRef: 'unknown_child',
					loginDate: '2026-03-15',
					rank: 'gold',
					basePoints: 5,
					multiplier: 1.0,
					totalPoints: 5,
					consecutiveDays: 1,
					createdAt: '2026-03-15T00:00:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });

			await importFamilyData(data, TENANT);

			expect(mockInsertLoginBonus).not.toHaveBeenCalled();
		});
	});

	describe('チェックリストテンプレートのインポート', () => {
		it('テンプレートとアイテムが正常にインポートされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.checklistTemplates = [
				{
					childRef: 'c1',
					name: 'あさのしたく',
					icon: '🌅',
					pointsPerItem: 2,
					completionBonus: 5,
					isActive: true,
					items: [
						{
							name: 'はみがき',
							icon: '🪥',
							frequency: 'daily',
							direction: 'morning',
							sortOrder: 1,
						},
						{
							name: 'きがえ',
							icon: '👕',
							frequency: 'daily',
							direction: 'morning',
							sortOrder: 2,
						},
					],
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockInsertTemplate.mockResolvedValue({ id: 50 });
			mockInsertTemplateItem.mockResolvedValue({});

			await importFamilyData(data, TENANT);

			expect(mockInsertTemplate).toHaveBeenCalledWith(
				expect.objectContaining({
					childId: 101,
					name: 'あさのしたく',
					isActive: 1, // boolean -> number conversion
				}),
				TENANT,
			);
			expect(mockInsertTemplateItem).toHaveBeenCalledTimes(2);
			expect(mockInsertTemplateItem).toHaveBeenCalledWith(
				expect.objectContaining({
					templateId: 50,
					name: 'はみがき',
					sortOrder: 1,
				}),
				TENANT,
			);
		});

		it('isActive が false の場合は 0 に変換される', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.checklistTemplates = [
				{
					childRef: 'c1',
					name: '非アクティブリスト',
					icon: '📋',
					pointsPerItem: 1,
					completionBonus: 0,
					isActive: false,
					items: [],
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockInsertTemplate.mockResolvedValue({ id: 51 });

			await importFamilyData(data, TENANT);

			expect(mockInsertTemplate).toHaveBeenCalledWith(
				expect.objectContaining({ isActive: 0 }),
				TENANT,
			);
		});

		it('テンプレート作成失敗時はエラーが追加される', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.checklistTemplates = [
				{
					childRef: 'c1',
					name: '失敗リスト',
					icon: '📋',
					pointsPerItem: 1,
					completionBonus: 0,
					isActive: true,
					items: [],
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockInsertTemplate.mockRejectedValue(new Error('constraint error'));

			const result = await importFamilyData(data, TENANT);

			expect(result.errors).toEqual(
				expect.arrayContaining([expect.stringContaining('失敗リスト')]),
			);
		});
	});

	describe('ステータス履歴のインポート', () => {
		it('正常にインポートされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.statusHistory = [
				{
					childRef: 'c1',
					categoryCode: 'seikatsu',
					value: 42.5,
					changeAmount: 0.5,
					changeType: 'activity',
					recordedAt: '2026-03-15T08:30:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });
			mockInsertStatusHistory.mockResolvedValue({});

			await importFamilyData(data, TENANT);

			expect(mockInsertStatusHistory).toHaveBeenCalledWith(
				expect.objectContaining({
					childId: 101,
					categoryId: 3, // seikatsu = 3
					value: 42.5,
					changeAmount: 0.5,
					changeType: 'activity',
				}),
				TENANT,
			);
		});

		it('不明なカテゴリコードのステータス履歴はスキップされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1')];
			data.data.statusHistory = [
				{
					childRef: 'c1',
					categoryCode: 'invalid_code',
					value: 50,
					changeAmount: 1,
					changeType: 'activity',
					recordedAt: '2026-03-15T08:30:00Z',
				},
			];

			mockInsertChild.mockResolvedValue({ id: 101 });

			await importFamilyData(data, TENANT);

			expect(mockInsertStatusHistory).not.toHaveBeenCalled();
		});
	});

	describe('統合シナリオ: フルインポート', () => {
		it('複数の子供と各データが正しくインポートされる', async () => {
			const data = makeExportData();
			data.family.children = [makeChild('c1', 'たろう'), makeChild('c2', 'はなこ')];
			data.master.activities = [
				{
					name: 'かけっこ',
					categoryCode: 'undou',
					icon: '🏃',
					basePoints: 5,
					gradeLevel: null,
					nameKana: null,
					nameKanji: null,
					triggerHint: null,
				},
			];
			data.data.activityLogs = [
				{
					childRef: 'c1',
					activityName: 'かけっこ',
					activityCategory: 'undou',
					points: 5,
					streakDays: 1,
					streakBonus: 0,
					recordedDate: '2026-03-15',
					recordedAt: '2026-03-15T08:30:00Z',
					cancelled: false,
				},
				{
					childRef: 'c2',
					activityName: 'かけっこ',
					activityCategory: 'undou',
					points: 5,
					streakDays: 1,
					streakBonus: 0,
					recordedDate: '2026-03-15',
					recordedAt: '2026-03-15T09:00:00Z',
					cancelled: false,
				},
			];
			data.data.statuses = [
				{
					childRef: 'c1',
					categoryCode: 'undou',
					totalXp: 50,
					level: 3,
					peakXp: 50,
					updatedAt: '2026-03-15T08:30:00Z',
				},
			];

			mockInsertChild.mockResolvedValueOnce({ id: 201 }).mockResolvedValueOnce({ id: 202 });
			// First call for master import check, then for lookup building
			mockFindActivities
				.mockResolvedValueOnce([]) // master import check: no existing
				.mockResolvedValueOnce([{ name: 'かけっこ', id: 99 }]); // lookup building after master import
			mockInsertActivity.mockResolvedValue({ id: 99 });
			mockInsertActivityLog.mockResolvedValue({});
			mockUpsertStatus.mockResolvedValue({});

			const result = await importFamilyData(data, TENANT);

			expect(result.childrenImported).toBe(2);
			expect(result.activitiesCreated).toBe(1);
			expect(result.activityLogsImported).toBe(2);
			expect(result.statusesImported).toBe(1);
			expect(result.errors).toHaveLength(0);
		});
	});
});
