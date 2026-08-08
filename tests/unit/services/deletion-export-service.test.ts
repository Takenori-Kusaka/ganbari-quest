// tests/unit/services/deletion-export-service.test.ts
// #740: 削除前エクスポートサービスのユニットテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asCategoryId } from '$lib/domain/ids';

// --- mocks ---

const mockFindAllChildren = vi.fn();
const mockFindActivities = vi.fn();
const mockFindActivityLogs = vi.fn();
const mockFindStatuses = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: { findAllChildren: mockFindAllChildren },
		activity: { findActivities: mockFindActivities, findActivityLogs: mockFindActivityLogs },
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
		rewardRedemptions: [],
		settings: [],
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
					id: '1',
					nickname: 'たろう',
					age: 6,
					uiMode: 'elementary',
					createdAt: '2026-01-01T00:00:00.000Z',
				},
				{
					id: '2',
					nickname: 'はなこ',
					age: 4,
					uiMode: 'preschool',
					createdAt: '2026-02-01T00:00:00.000Z',
				},
			]);
			mockFindStatuses.mockResolvedValue([
				{
					categoryId: asCategoryId(1),
					totalXp: 100,
					level: 3,
					peakXp: 100,
					updatedAt: '2026-04-17',
				},
				{ categoryId: asCategoryId(2), totalXp: 50, level: 2, peakXp: 50, updatedAt: '2026-04-17' },
			]);
			// たろう: 5件、はなこ: 3件の活動ログ
			mockFindActivityLogs
				.mockResolvedValueOnce([{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }])
				.mockResolvedValueOnce([{ id: '6' }, { id: '7' }, { id: '8' }]);

			const result = await generateMinimalExport('tenant-1');

			expect(result.format).toBe('ganbari-quest-deletion-export');
			expect(result.scope).toBe('minimal');
			expect(result.children).toHaveLength(2);
			expect(result.children[0]?.nickname).toBe('たろう');
			expect(result.activitySummary).toHaveLength(2);
			expect(result.activitySummary[0]?.totalPoints).toBe(150);
			// 子供ごとの活動数が正しくカウントされること
			expect(result.activitySummary[0]?.totalActivities).toBe(5);
			expect(result.activitySummary[1]?.totalActivities).toBe(3);
			// カテゴリ名がSSOTから取得されること
			expect(result.activitySummary[0]?.categories[0]?.name).toBe('うんどう');
			expect(result.activitySummary[0]?.categories[1]?.name).toBe('べんきょう');
		});

		// #4450: `firstRecordDate` / `lastRecordDate` は「活動ログの最初 / 最後の記録日」であり、
		// 子供の登録日 (`child.createdAt`) ではない。退会時に顧客へ手渡す成果物
		// (ADR-0049 / GDPR 第 15 条) なので、フィールド名と中身が食い違ってはならない。
		// #4120: 日付は JST 暦日。ISO UTC を素朴に slice(0, 10) すると JST 00:00〜09:00 の記録が
		// 前日として書き出され、削除受領証 / retention 監査との突き合わせで 1 日食い違う。
		// 本 test は **暦日の timezone と、値の意味 (登録日ではなく記録日である) の両方**を固定する。
		it('firstRecordDate / lastRecordDate に活動ログの最初・最後の記録日が JST 暦日で入る', async () => {
			mockFindAllChildren.mockResolvedValue([
				{
					id: '1',
					nickname: 'たろう',
					age: 6,
					uiMode: 'elementary',
					// UTC 2026-06-30 15:10 = JST 2026-07-01 00:10 (登録日。記録日ではない)
					createdAt: '2026-06-30T15:10:00.000Z',
				},
			]);
			mockFindStatuses.mockResolvedValue([]);
			// repo は recordedAt DESC で返す (sqlite / dsql)
			mockFindActivityLogs.mockResolvedValue([
				{ id: '2', recordedAt: '2026-08-05T13:00:00.000Z' }, // JST 2026-08-05 22:00
				{ id: '1', recordedAt: '2026-07-31T15:10:00.000Z' }, // JST 2026-08-01 00:10
			]);

			const result = await generateMinimalExport('tenant-1');

			expect(result.activitySummary[0]?.firstRecordDate).toBe('2026-08-01');
			expect(result.activitySummary[0]?.lastRecordDate).toBe('2026-08-05');
			// UTC 暦日 (素朴な slice) なら前日になる = 本 assert は UTC 実装で必ず落ちる
			expect(result.activitySummary[0]?.firstRecordDate).not.toBe('2026-07-31');
			// 登録日 (JST 2026-07-01) を「最初の記録日」として出さない
			expect(result.activitySummary[0]?.firstRecordDate).not.toBe('2026-07-01');
			// 登録日そのものは children[] 側で引き続き開示される
			expect(result.children[0]?.createdAt).toBe('2026-06-30T15:10:00.000Z');
		});

		it('記録日は repo の返却順に依存しない (昇順で返しても同じ)', async () => {
			mockFindAllChildren.mockResolvedValue([
				{
					id: '1',
					nickname: 'たろう',
					age: 6,
					uiMode: 'elementary',
					createdAt: '2026-06-30T15:10:00.000Z',
				},
			]);
			mockFindStatuses.mockResolvedValue([]);
			// demo repo は順序を保証しない
			mockFindActivityLogs.mockResolvedValue([
				{ id: '1', recordedAt: '2026-07-31T15:10:00.000Z' },
				{ id: '2', recordedAt: '2026-08-05T13:00:00.000Z' },
			]);

			const result = await generateMinimalExport('tenant-1');

			expect(result.activitySummary[0]?.firstRecordDate).toBe('2026-08-01');
			expect(result.activitySummary[0]?.lastRecordDate).toBe('2026-08-05');
		});

		it('活動ログが 0 件なら firstRecordDate / lastRecordDate とも null (登録日で埋めない)', async () => {
			mockFindAllChildren.mockResolvedValue([
				{
					id: '1',
					nickname: 'たろう',
					age: 6,
					uiMode: 'elementary',
					createdAt: '2026-06-30T15:10:00.000Z',
				},
			]);
			mockFindStatuses.mockResolvedValue([]);
			mockFindActivityLogs.mockResolvedValue([]);

			const result = await generateMinimalExport('tenant-1');

			expect(result.activitySummary[0]?.firstRecordDate).toBeNull();
			expect(result.activitySummary[0]?.lastRecordDate).toBeNull();
		});

		it('子供がいない場合も空の結果を返す', async () => {
			mockFindAllChildren.mockResolvedValue([]);

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
				{ id: '1', nickname: 'たろう', age: 6 },
				{ id: '2', nickname: 'はなこ', age: 4 },
			]);
			mockFindStatuses
				.mockResolvedValueOnce([
					{
						categoryId: asCategoryId(1),
						totalXp: 200,
						level: 5,
						peakXp: 200,
						updatedAt: '2026-04-17',
					},
				])
				.mockResolvedValueOnce([
					{
						categoryId: asCategoryId(1),
						totalXp: 100,
						level: 3,
						peakXp: 100,
						updatedAt: '2026-04-17',
					},
				]);

			const result = await generateSiblingComparison('tenant-1');

			expect(result.children).toHaveLength(2);
			expect(result.children[0]?.nickname).toBe('たろう');
			expect(result.children[0]?.totalPoints).toBe(200);
			expect(result.children[1]?.nickname).toBe('はなこ');
			expect(result.children[1]?.totalPoints).toBe(100);
		});
	});

	// ============================================================
	// generateDeletionExport
	// ============================================================

	describe('generateDeletionExport', () => {
		it('free プランで minimal エクスポートを生成する', async () => {
			mockFindAllChildren.mockResolvedValue([]);

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
			mockFindAllChildren.mockResolvedValue([{ id: '1', nickname: 'たろう', age: 6 }]);
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
