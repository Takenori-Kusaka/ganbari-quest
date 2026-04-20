// tests/unit/services/import-service.spec.ts
// #1254: G2 重複検知の 2 段チェック / G4 checksum 検証 / silent try-catch 廃止 の検証

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Top-level mocks ----------

const mockFindActivities = vi.fn();
const mockFindActivityLogs = vi.fn();
const mockInsertActivity = vi.fn();
const mockInsertActivityLog = vi.fn();
const mockInsertPointLedger = vi.fn();
const mockInsertChild = vi.fn();
const mockUpsertStatus = vi.fn();
const mockInsertStatusHistory = vi.fn();
const mockFindRecentBonuses = vi.fn();
const mockInsertLoginBonus = vi.fn();
const mockInsertTemplate = vi.fn();
const mockInsertTemplateItem = vi.fn();
const mockFindSpecialRewards = vi.fn();
const mockInsertSpecialReward = vi.fn();

vi.mock('$lib/server/db/activity-repo', () => ({
	findActivities: (...args: unknown[]) => mockFindActivities(...args),
	findActivityLogs: (...args: unknown[]) => mockFindActivityLogs(...args),
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

vi.mock('$lib/server/db/login-bonus-repo', () => ({
	findRecentBonuses: (...args: unknown[]) => mockFindRecentBonuses(...args),
	insertLoginBonus: (...args: unknown[]) => mockInsertLoginBonus(...args),
}));

vi.mock('$lib/server/db/checklist-repo', () => ({
	insertTemplate: (...args: unknown[]) => mockInsertTemplate(...args),
	insertTemplateItem: (...args: unknown[]) => mockInsertTemplateItem(...args),
}));

vi.mock('$lib/server/db/special-reward-repo', () => ({
	findSpecialRewards: (...args: unknown[]) => mockFindSpecialRewards(...args),
	insertSpecialReward: (...args: unknown[]) => mockInsertSpecialReward(...args),
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
	verifyChecksum,
} from '../../../src/lib/server/services/import-service';

// ---------- Helpers ----------

const TENANT = 'test-tenant-001';

function makeExportData(overrides: Partial<ExportData> = {}): ExportData {
	return {
		format: 'ganbari-quest-backup',
		version: '1.1.0',
		exportedAt: '2026-04-20T00:00:00Z',
		checksum: '',
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
		uiMode: 'preschool',
		avatarUrl: null,
		activeTitle: null,
		createdAt: '2025-06-01T00:00:00Z',
	};
}

async function computeChecksumFor(data: ExportData): Promise<string> {
	const payload = JSON.stringify({ ...data, checksum: undefined });
	const buffer = new TextEncoder().encode(payload);
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return `sha256:${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFindActivities.mockResolvedValue([]);
	mockFindActivityLogs.mockResolvedValue([]);
	mockFindRecentBonuses.mockResolvedValue([]);
	mockFindSpecialRewards.mockResolvedValue([]);
});

// ============================================================
// G4: checksum verification
// ============================================================

describe('verifyChecksum (#1254 G4)', () => {
	it('checksum が空文字列の場合は検証スキップ (後方互換)', async () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1')];
		data.checksum = '';
		const ok = await verifyChecksum(data);
		expect(ok).toBe(true);
	});

	it('checksum が正しければ true を返す', async () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1')];
		data.checksum = await computeChecksumFor(data);
		const ok = await verifyChecksum(data);
		expect(ok).toBe(true);
	});

	it('checksum が不一致なら false を返す', async () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1')];
		data.checksum = 'sha256:deadbeef00000000000000000000000000000000000000000000000000000000';
		const ok = await verifyChecksum(data);
		expect(ok).toBe(false);
	});

	it('checksum 計算対象からは checksum 自身を除外する (self-reference 回避)', async () => {
		const data1 = makeExportData();
		data1.family.children = [makeChild('c1')];
		const h1 = await computeChecksumFor(data1);

		const data2 = { ...data1, checksum: h1 };
		const h2 = await computeChecksumFor(data2);
		// checksum フィールドは除外されるので、h1 と h2 は一致する
		expect(h2).toBe(h1);
	});
});

// ============================================================
// G2: previewImport returns duplicates array
// ============================================================

describe('previewImport duplicates (#1254 G2)', () => {
	it('活動マスタに既存同名がある場合は duplicates.activities に name_duplicate 理由で追加される', async () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1')];
		data.master.activities = [
			{
				name: '既存活動',
				categoryCode: 'undou',
				icon: '🏃',
				basePoints: 10,
				gradeLevel: null,
				nameKana: null,
				nameKanji: null,
				triggerHint: null,
			},
			{
				name: '新規活動',
				categoryCode: 'benkyou',
				icon: '📚',
				basePoints: 8,
				gradeLevel: null,
				nameKana: null,
				nameKanji: null,
				triggerHint: null,
			},
		];
		mockFindActivities.mockResolvedValue([{ id: 1, name: '既存活動' }]);

		const preview = await previewImport(data, TENANT);

		expect(preview.duplicates.activities).toEqual([
			{ label: '既存活動', reason: 'name_duplicate' },
		]);
	});

	it('重複がない場合 duplicates 配列は空', async () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1')];
		const preview = await previewImport(data, TENANT);
		expect(preview.duplicates.activities).toEqual([]);
		expect(preview.duplicates.specialRewards).toEqual([]);
		expect(preview.duplicates.checklistTemplates).toEqual([]);
		expect(preview.duplicates.activityLogs).toEqual([]);
		expect(preview.duplicates.loginBonuses).toEqual([]);
	});
});

// ============================================================
// G2: silent try-catch elimination — pre-fetch で skip される
// ============================================================

describe('importFamilyData pre-fetch skip (#1254 G2)', () => {
	it('既存 activityLog (childId + activityName + recordedAt) があれば insertActivityLog を呼ばず skip + skipped.constraint 加算', async () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1')];
		data.data.activityLogs = [
			{
				childRef: 'c1',
				activityName: '運動',
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
		mockFindActivities.mockResolvedValue([{ id: 5, name: '運動' }]);
		mockFindActivityLogs.mockResolvedValue([
			{ activityName: '運動', recordedAt: '2026-03-15T08:30:00Z' },
		]);

		const result = await importFamilyData(data, TENANT);

		expect(result.activityLogsImported).toBe(0);
		expect(result.activityLogsSkipped).toBe(1);
		expect(result.skipped.constraint).toBe(1);
		// pre-fetch で skip されるので insertActivityLog は呼ばれない
		expect(mockInsertActivityLog).not.toHaveBeenCalled();
	});

	it('既存 loginBonus (childId + loginDate) があれば insertLoginBonus を呼ばず skip + skipped.constraint 加算', async () => {
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
		mockFindRecentBonuses.mockResolvedValue([{ loginDate: '2026-03-15' }]);

		const result = await importFamilyData(data, TENANT);

		expect(result.loginBonusesImported).toBe(0);
		expect(result.loginBonusesSkipped).toBe(1);
		expect(result.skipped.constraint).toBe(1);
		expect(mockInsertLoginBonus).not.toHaveBeenCalled();
	});

	it('マスタ活動の名前重複は skipped.name に計上', async () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1')];
		data.master.activities = [
			{
				name: '重複活動',
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
		mockFindActivities.mockResolvedValue([{ id: 1, name: '重複活動' }]);

		const result = await importFamilyData(data, TENANT);

		expect(result.activitiesCreated).toBe(0);
		expect(result.skipped.name).toBe(1);
		expect(mockInsertActivity).not.toHaveBeenCalled();
	});

	it('ごほうび名重複は skipped.name に計上', async () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1')];
		data.data.specialRewards = [
			{
				childRef: 'c1',
				title: 'おこづかい',
				description: null,
				points: 100,
				icon: null,
				category: 'money',
				grantedAt: '2026-03-15T00:00:00Z',
			},
		];
		mockInsertChild.mockResolvedValue({ id: 101 });
		mockFindSpecialRewards.mockResolvedValue([{ id: 10, title: 'おこづかい' }]);

		const result = await importFamilyData(data, TENANT);

		expect(result.specialRewardsImported).toBe(0);
		expect(result.specialRewardsSkipped).toBe(1);
		expect(result.skipped.name).toBe(1);
		expect(mockInsertSpecialReward).not.toHaveBeenCalled();
	});
});

// ============================================================
// G2: silent try-catch 廃止 — insert 失敗時は errors に push される
// ============================================================

describe('importFamilyData explicit error reporting (#1254 G2)', () => {
	it('pointLedger insert 失敗時は errors に push される (silent 廃止)', async () => {
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
		mockInsertPointLedger.mockRejectedValue(new Error('DB failure'));

		const result = await importFamilyData(data, TENANT);

		expect(result.pointLedgerSkipped).toBe(1);
		expect(result.errors).toEqual(
			expect.arrayContaining([expect.stringContaining('ポイント台帳 insert 失敗')]),
		);
	});

	it('statusHistory insert 失敗時は errors に push される (silent 廃止)', async () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1')];
		data.data.statusHistory = [
			{
				childRef: 'c1',
				categoryCode: 'undou',
				value: 10,
				changeAmount: 1,
				changeType: 'activity',
				recordedAt: '2026-03-15T08:30:00Z',
			},
		];
		mockInsertChild.mockResolvedValue({ id: 101 });
		mockInsertStatusHistory.mockRejectedValue(new Error('DB failure'));

		const result = await importFamilyData(data, TENANT);

		expect(result.statusHistorySkipped).toBe(1);
		expect(result.errors).toEqual(
			expect.arrayContaining([expect.stringContaining('ステータス履歴 insert 失敗')]),
		);
	});
});

// ============================================================
// validateExportData: checksum は関与しないことを確認
// ============================================================

describe('validateExportData + verifyChecksum separation', () => {
	it('validateExportData は構造検証のみで checksum は見ない', () => {
		const data = makeExportData();
		data.family.children = [makeChild('c1')];
		data.checksum = 'sha256:wrong-value';
		const result = validateExportData(data);
		expect(result.valid).toBe(true);
	});
});
