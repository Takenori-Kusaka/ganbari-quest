// tests/unit/services/tenant-cleanup-service.test.ts
// #739: テナントデータクリーンアップ共通ヘルパーのユニットテスト
//
// 目的:
// - deleteAllChildrenData と deleteTenantScopedData のスコープ境界を明示的に検証
// - スタブされたリポジトリの各 delete メソッドが正しく呼ばれることを保証
// - 1 箇所の削除エラーが他の削除をブロックしないことを保証

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Top-level mocks ---

const mockChildRepo = {
	findAllChildren: vi.fn(),
	deleteChild: vi.fn().mockResolvedValue(undefined),
};

const mockActivityRepo = {
	findActivities: vi.fn().mockResolvedValue([]),
	deleteActivity: vi.fn().mockResolvedValue(undefined),
};

const mockViewerTokenRepo = {
	findByTenant: vi.fn().mockResolvedValue([]),
	deleteById: vi.fn().mockResolvedValue(undefined),
};

const mockCloudExportRepo = {
	findByTenant: vi.fn().mockResolvedValue([]),
	deleteById: vi.fn().mockResolvedValue(undefined),
};

const mockPushSubscriptionRepo = {
	findByTenant: vi.fn().mockResolvedValue([]),
	deleteByEndpoint: vi.fn().mockResolvedValue(undefined),
};

const mockVoiceRepo = {
	deleteByChild: vi.fn().mockResolvedValue(undefined),
};

// deleteByTenantId 系の共通スタブ（20+ テーブル）
const mkTenantDelete = () => ({ deleteByTenantId: vi.fn().mockResolvedValue(undefined) });
const mockSettingsRepo = mkTenantDelete();
const mockChecklistRepo = mkTenantDelete();
const mockDailyMissionRepo = mkTenantDelete();
const mockEvaluationRepo = mkTenantDelete();
const mockPointRepo = mkTenantDelete();
const mockStampCardRepo = mkTenantDelete();
const mockStatusRepo = mkTenantDelete();
const mockLoginBonusRepo = mkTenantDelete();
const mockSpecialRewardRepo = mkTenantDelete();
const mockActivityPrefRepo = mkTenantDelete();
const mockActivityMasteryRepo = mkTenantDelete();
const mockMessageRepo = mkTenantDelete();
const mockTenantEventRepo = mkTenantDelete();
const mockTrialHistoryRepo = mkTenantDelete();
const mockSiblingChallengeRepo = mkTenantDelete();
const mockSiblingCheerRepo = mkTenantDelete();
const mockAutoChallengeRepo = mkTenantDelete();
const mockReportDailySummaryRepo = mkTenantDelete();
const mockSeasonEventRepo = mkTenantDelete();
const mockImageRepo = mkTenantDelete();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: mockChildRepo,
		activity: mockActivityRepo,
		viewerToken: mockViewerTokenRepo,
		cloudExport: mockCloudExportRepo,
		pushSubscription: mockPushSubscriptionRepo,
		voice: mockVoiceRepo,
		settings: mockSettingsRepo,
		checklist: mockChecklistRepo,
		dailyMission: mockDailyMissionRepo,
		evaluation: mockEvaluationRepo,
		point: mockPointRepo,
		stampCard: mockStampCardRepo,
		status: mockStatusRepo,
		loginBonus: mockLoginBonusRepo,
		specialReward: mockSpecialRewardRepo,
		activityPref: mockActivityPrefRepo,
		activityMastery: mockActivityMasteryRepo,
		message: mockMessageRepo,
		tenantEvent: mockTenantEventRepo,
		trialHistory: mockTrialHistoryRepo,
		siblingChallenge: mockSiblingChallengeRepo,
		siblingCheer: mockSiblingCheerRepo,
		autoChallenge: mockAutoChallengeRepo,
		reportDailySummary: mockReportDailySummaryRepo,
		seasonEvent: mockSeasonEventRepo,
		image: mockImageRepo,
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('$lib/server/request-context', () => ({
	invalidateRequestCaches: vi.fn(),
}));

const mockDeleteChildFiles = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/services/child-service', () => ({
	deleteChildFiles: (...args: unknown[]) => mockDeleteChildFiles(...args),
}));
vi.mock('./child-service', () => ({
	deleteChildFiles: (...args: unknown[]) => mockDeleteChildFiles(...args),
}));

// --- Imports (after mocks) ---

import {
	deleteAllChildrenData,
	deleteTenantScopedData,
} from '$lib/server/services/tenant-cleanup-service';

const TENANT = 'test-tenant-739';

beforeEach(() => {
	vi.clearAllMocks();
	// デフォルトで children は空
	mockChildRepo.findAllChildren.mockResolvedValue([]);
});

// =========================================================
// deleteAllChildrenData
// =========================================================

describe('deleteAllChildrenData', () => {
	it('子供がいない場合は 0 を返す', async () => {
		const deleted = await deleteAllChildrenData(TENANT);
		expect(deleted).toBe(0);
		expect(mockChildRepo.deleteChild).not.toHaveBeenCalled();
	});

	it('全子供について deleteChildFiles + deleteChild が呼ばれる', async () => {
		mockChildRepo.findAllChildren.mockResolvedValue([
			{ id: 1, nickname: '太郎' },
			{ id: 2, nickname: '花子' },
		]);

		const deleted = await deleteAllChildrenData(TENANT);

		expect(deleted).toBe(2);
		expect(mockDeleteChildFiles).toHaveBeenCalledTimes(2);
		expect(mockChildRepo.deleteChild).toHaveBeenCalledTimes(2);
		expect(mockChildRepo.deleteChild).toHaveBeenCalledWith(1, TENANT);
		expect(mockChildRepo.deleteChild).toHaveBeenCalledWith(2, TENANT);
	});

	it('1 人の削除が失敗しても他の子供は削除を続行する', async () => {
		mockChildRepo.findAllChildren.mockResolvedValue([
			{ id: 1, nickname: '太郎' },
			{ id: 2, nickname: '花子' },
		]);
		// 1 人目は失敗、2 人目は成功
		mockChildRepo.deleteChild
			.mockRejectedValueOnce(new Error('db err'))
			.mockResolvedValueOnce(undefined);

		const deleted = await deleteAllChildrenData(TENANT);

		expect(deleted).toBe(1); // 成功したのは 1 人だけ
		expect(mockChildRepo.deleteChild).toHaveBeenCalledTimes(2);
	});

	it('scope boundary: tenant-scoped な repo は呼ばれない', async () => {
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: 1, nickname: '太郎' }]);

		await deleteAllChildrenData(TENANT);

		// trial_history / settings / checklist 等はスコープ外なので呼ばれない
		expect(mockTrialHistoryRepo.deleteByTenantId).not.toHaveBeenCalled();
		expect(mockSettingsRepo.deleteByTenantId).not.toHaveBeenCalled();
		expect(mockChecklistRepo.deleteByTenantId).not.toHaveBeenCalled();
	});
});

// =========================================================
// deleteTenantScopedData
// =========================================================

describe('deleteTenantScopedData', () => {
	it('trial_history を含む全テナントスコープ repo の deleteByTenantId が呼ばれる', async () => {
		await deleteTenantScopedData(TENANT);

		expect(mockTrialHistoryRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockSettingsRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockChecklistRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockSpecialRewardRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockDailyMissionRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockEvaluationRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockPointRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockStampCardRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockStatusRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockLoginBonusRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockActivityPrefRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockActivityMasteryRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockMessageRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockTenantEventRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockSiblingChallengeRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockSiblingCheerRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockAutoChallengeRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockReportDailySummaryRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockSeasonEventRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockImageRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
	});

	it('activities / viewerTokens / cloudExports / pushSubscriptions は find+delete パターン', async () => {
		mockActivityRepo.findActivities.mockResolvedValue([
			{ id: 10, name: 'test1' },
			{ id: 11, name: 'test2' },
		]);
		mockViewerTokenRepo.findByTenant.mockResolvedValue([{ id: 'tk1' }]);
		mockCloudExportRepo.findByTenant.mockResolvedValue([{ id: 'ex1' }]);
		mockPushSubscriptionRepo.findByTenant.mockResolvedValue([{ endpoint: 'https://push1' }]);

		await deleteTenantScopedData(TENANT);

		expect(mockActivityRepo.deleteActivity).toHaveBeenCalledTimes(2);
		expect(mockViewerTokenRepo.deleteById).toHaveBeenCalledWith('tk1', TENANT);
		expect(mockCloudExportRepo.deleteById).toHaveBeenCalledWith('ex1', TENANT);
		expect(mockPushSubscriptionRepo.deleteByEndpoint).toHaveBeenCalledWith('https://push1', TENANT);
	});

	it('1 つの repo の削除失敗は他の削除をブロックしない', async () => {
		// trial_history の削除を失敗させる
		mockTrialHistoryRepo.deleteByTenantId.mockRejectedValueOnce(new Error('db err'));

		await deleteTenantScopedData(TENANT);

		// trial_history が失敗しても、他の repo は削除が呼ばれている
		expect(mockSettingsRepo.deleteByTenantId).toHaveBeenCalled();
		expect(mockChecklistRepo.deleteByTenantId).toHaveBeenCalled();
		expect(mockImageRepo.deleteByTenantId).toHaveBeenCalled();
	});

	it('scope boundary: children の削除は呼ばれない', async () => {
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: 1, nickname: '太郎' }]);

		await deleteTenantScopedData(TENANT);

		// children テーブル自体の削除は deleteAllChildrenData の責務
		expect(mockChildRepo.deleteChild).not.toHaveBeenCalled();
		expect(mockDeleteChildFiles).not.toHaveBeenCalled();
		// ただし voice.deleteByChild は子供ごとに呼ばれる（子供に紐づくテナントスコープ扱い）
		expect(mockVoiceRepo.deleteByChild).toHaveBeenCalledWith(1, TENANT);
	});
});
