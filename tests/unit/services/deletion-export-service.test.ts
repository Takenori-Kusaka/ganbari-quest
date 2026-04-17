// tests/unit/services/deletion-export-service.test.ts
// #740: 削除前エクスポートサービスのユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- mocks ---

const mockFindAllChildren = vi.fn();
const mockFindActivities = vi.fn();
const mockFindStatuses = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: { findAllChildren: mockFindAllChildren },
		activity: { findActivities: mockFindActivities },
		status: { findStatuses: mockFindStatuses },
	}),
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
}));

vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: vi.fn().mockResolvedValue({
		isTrialActive: false,
		trialUsed: false,
		trialStartDate: null,
		trialEndDate: null,
		trialTier: null,
		daysRemaining: 0,
		source: null,
	}),
}));

vi.mock('$lib/server/request-context', () => ({
	getRequestContext: () => null,
	buildPlanTierCacheKey: (...args: unknown[]) => args.join(':'),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// export-service のモック（full export 用）
const mockExportFamilyData = vi.fn().mockResolvedValue({
	format: 'ganbari-quest-backup',
	version: '1.1.0',
	exportedAt: '2026-04-17T00:00:00.000Z',
	checksum: 'sha256:abc123',
	master: { categories: [], activities: [], titles: [], achievements: [], avatarItems: [] },
	family: { children: [] },
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
});

vi.mock('$lib/server/services/export-service', () => ({
	exportFamilyData: (...args: unknown[]) => mockExportFamilyData(...args),
}));

import {
	generateDeletionExport,
	generateMinimalExport,
	generateSiblingComparison,
	resolveExportScope,
} from '$lib/server/services/deletion-export-service';

describe('deletion-export-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ============================================================
	// resolveExportScope
	// ============================================================

	describe('resolveExportScope', () => {
		it('free プランは minimal スコープ', () => {
			expect(resolveExportScope('free')).toBe('minimal');
		});

		it('standard プランは full スコープ', () => {
			expect(resolveExportScope('standard')).toBe('full');
		});

		it('family プランは family スコープ', () => {
			expect(resolveExportScope('family')).toBe('family');
		});
	});

	// ============================================================
	// generateMinimalExport
	// ============================================================

	describe('generateMinimalExport', () => {
		it('子供名とサマリを含む最小限のエクスポートを生成する', async () => {
			mockFindAllChildren.mockResolvedValue([
				{
					id: 1,
					nickname: 'たろう',
					age: 6,
					uiMode: 'elementary',
					createdAt: '2026-01-01T00:00:00.000Z',
				},
				{
					id: 2,
					nickname: 'はなこ',
					age: 4,
					uiMode: 'preschool',
					createdAt: '2026-02-01T00:00:00.000Z',
				},
			]);
			mockFindActivities.mockResolvedValue([{ id: 1, name: 'うんどう', source: 'seed' }]);
			mockFindStatuses.mockResolvedValue([
				{ categoryId: 1, totalXp: 100, level: 3, peakXp: 100, updatedAt: '2026-04-17' },
				{ categoryId: 2, totalXp: 50, level: 2, peakXp: 50, updatedAt: '2026-04-17' },
			]);

			const result = await generateMinimalExport('tenant-1');

			expect(result.format).toBe('ganbari-quest-deletion-export');
			expect(result.scope).toBe('minimal');
			expect(result.children).toHaveLength(2);
			expect(result.children[0]!.nickname).toBe('たろう');
			expect(result.activitySummary).toHaveLength(2);
			expect(result.activitySummary[0]!.totalPoints).toBe(150);
		});

		it('子供がいない場合も空の結果を返す', async () => {
			mockFindAllChildren.mockResolvedValue([]);
			mockFindActivities.mockResolvedValue([]);

			const result = await generateMinimalExport('tenant-1');

			expect(result.children).toHaveLength(0);
			expect(result.activitySummary).toHaveLength(0);
		});
	});

	// ============================================================
	// generateSiblingComparison
	// ============================================================

	describe('generateSiblingComparison', () => {
		it('きょうだい比較データを生成する', async () => {
			mockFindAllChildren.mockResolvedValue([
				{ id: 1, nickname: 'たろう', age: 6 },
				{ id: 2, nickname: 'はなこ', age: 4 },
			]);
			mockFindStatuses
				.mockResolvedValueOnce([
					{ categoryId: 1, totalXp: 200, level: 5, peakXp: 200, updatedAt: '2026-04-17' },
				])
				.mockResolvedValueOnce([
					{ categoryId: 1, totalXp: 100, level: 3, peakXp: 100, updatedAt: '2026-04-17' },
				]);

			const result = await generateSiblingComparison('tenant-1');

			expect(result.children).toHaveLength(2);
			expect(result.children[0]!.nickname).toBe('たろう');
			expect(result.children[0]!.totalPoints).toBe(200);
			expect(result.children[1]!.nickname).toBe('はなこ');
			expect(result.children[1]!.totalPoints).toBe(100);
		});
	});

	// ============================================================
	// generateDeletionExport
	// ============================================================

	describe('generateDeletionExport', () => {
		it('free プランで minimal エクスポートを生成する', async () => {
			mockFindAllChildren.mockResolvedValue([]);
			mockFindActivities.mockResolvedValue([]);

			const result = await generateDeletionExport({
				tenantId: 'tenant-1',
				planTier: 'free',
			});

			expect(result.scope).toBe('minimal');
		});

		it('standard プランで full エクスポートを生成する', async () => {
			const result = await generateDeletionExport({
				tenantId: 'tenant-1',
				planTier: 'standard',
			});

			expect(result.scope).toBe('full');
			expect(mockExportFamilyData).toHaveBeenCalledWith({ tenantId: 'tenant-1' });
		});

		it('family プランで family エクスポート（full + sibling）を生成する', async () => {
			mockFindAllChildren.mockResolvedValue([{ id: 1, nickname: 'たろう', age: 6 }]);
			mockFindStatuses.mockResolvedValue([]);

			const result = await generateDeletionExport({
				tenantId: 'tenant-1',
				planTier: 'family',
			});

			expect(result.scope).toBe('family');
			expect(mockExportFamilyData).toHaveBeenCalled();
		});
	});
});
