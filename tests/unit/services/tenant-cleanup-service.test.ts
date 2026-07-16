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
	// #3693: deleteTenantScopedData は archived 児童も childIds に含める (Scan 時代の削除範囲と同一)
	findArchivedChildren: vi.fn(),
	deleteChild: vi.fn().mockResolvedValue(undefined),
	// #3750: orphan child partition sweep (DynamoDB backend 固有、optional method)
	sweepOrphanChildPartitions: vi.fn().mockResolvedValue(0),
};

const mockActivityRepo = {
	findActivities: vi.fn().mockResolvedValue([]),
	deleteActivity: vi.fn().mockResolvedValue(undefined),
};

// #2362 PR-3 (ADR-0055): per-child instance repo の mock
const mockChildActivityRepo = {
	findActivitiesByChild: vi.fn().mockResolvedValue([]),
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
// #2295 (EPIC #2294 ①): mockTenantEventRepo / mockSeasonEventRepo 削除済 (2026-05-19)
// #2458 (Path B sibling drop): mockSiblingChallengeRepo 削除済 (2026-05-26)、child-challenge-repo へ移行
const mockTrialHistoryRepo = mkTenantDelete();
const mockSiblingCheerRepo = mkTenantDelete();
// #3213 (EPIC #3193): mockAutoChallengeRepo 削除済 (auto_challenges 廃止、child_challenges へ一本化)
const mockReportDailySummaryRepo = mkTenantDelete();
const mockImageRepo = mkTenantDelete();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: mockChildRepo,
		activity: mockActivityRepo,
		childActivity: mockChildActivityRepo,
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
		// #2295: tenantEvent / seasonEvent 削除済
		// #2458 (Path B sibling drop): siblingChallenge 削除済 (2026-05-26)
		trialHistory: mockTrialHistoryRepo,
		siblingCheer: mockSiblingCheerRepo,
		reportDailySummary: mockReportDailySummaryRepo,
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
	mockChildRepo.findArchivedChildren.mockResolvedValue([]);
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
			{ id: '1', nickname: '太郎' },
			{ id: '2', nickname: '花子' },
		]);

		const deleted = await deleteAllChildrenData(TENANT);

		expect(deleted).toBe(2);
		expect(mockDeleteChildFiles).toHaveBeenCalledTimes(2);
		expect(mockChildRepo.deleteChild).toHaveBeenCalledTimes(2);
		expect(mockChildRepo.deleteChild).toHaveBeenCalledWith('1', TENANT);
		expect(mockChildRepo.deleteChild).toHaveBeenCalledWith('2', TENANT);
	});

	it('1 人の削除が失敗しても他の子供は削除を続行する', async () => {
		mockChildRepo.findAllChildren.mockResolvedValue([
			{ id: '1', nickname: '太郎' },
			{ id: '2', nickname: '花子' },
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
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: '1', nickname: '太郎' }]);

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

		// tenant 直下 PK のみの repo は childIds を受け取らない
		expect(mockTrialHistoryRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockSettingsRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		expect(mockReportDailySummaryRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		// #3693: child-scoped repo は childIds を受け取る (児童 0 人時は undefined = Scan fallback)
		expect(mockChecklistRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockSpecialRewardRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockDailyMissionRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockEvaluationRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockPointRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockStampCardRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockStatusRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockLoginBonusRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockActivityPrefRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockActivityMasteryRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockMessageRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		// #2295: tenantEvent / seasonEvent 削除済
		// #2458 (Path B sibling drop): mockSiblingChallengeRepo.deleteByTenantId assertion 削除済 (2026-05-26)、
		// table 物理 drop 済のため tenant-cleanup-service も呼び出さない。child-challenges は child cascade で削除。
		expect(mockSiblingCheerRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		// #3213: autoChallenge.deleteByTenantId assertion 削除済 (auto_challenges 廃止、child cascade で削除)
		expect(mockImageRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
	});

	it('#3693: childIds (active + archived) を child-scoped repo の deleteByTenantId に渡す', async () => {
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: '100' }, { id: '200' }]);
		mockChildRepo.findArchivedChildren.mockResolvedValue([{ id: '300' }]);

		await deleteTenantScopedData(TENANT);

		const expectedIds = ['100', '200', '300'];
		expect(mockStatusRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, expectedIds);
		expect(mockPointRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, expectedIds);
		expect(mockChecklistRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, expectedIds);
		expect(mockStampCardRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, expectedIds);
		expect(mockImageRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, expectedIds);
		// tenant 直下 PK の repo には渡さない
		expect(mockSettingsRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
		// voice / activities の per-child ループは active 児童のみ (従来挙動を維持)
		expect(mockVoiceRepo.deleteByChild).toHaveBeenCalledTimes(2);
	});

	it('#3693: 児童一覧は先頭で 1 回だけ解決される (Scan 重複の排除)', async () => {
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: '100' }]);

		await deleteTenantScopedData(TENANT);

		// 旧実装は activities 用 + voice 用に 2 回列挙していた
		expect(mockChildRepo.findAllChildren).toHaveBeenCalledTimes(1);
		expect(mockChildRepo.findArchivedChildren).toHaveBeenCalledTimes(1);
	});

	it('#3693: 児童列挙が失敗しても childIds=undefined (Scan fallback) で削除を継続する', async () => {
		mockChildRepo.findAllChildren.mockRejectedValue(new Error('enumeration failed'));

		await deleteTenantScopedData(TENANT);

		expect(mockStatusRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockPointRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT, undefined);
		expect(mockSettingsRepo.deleteByTenantId).toHaveBeenCalledWith(TENANT);
	});

	it('#3750: childIds 非空時、末尾で orphan child partition sweep を childIds 付きで 1 回呼ぶ', async () => {
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: '100' }, { id: '200' }]);
		mockChildRepo.findArchivedChildren.mockResolvedValue([{ id: '300' }]);

		await deleteTenantScopedData(TENANT);

		// 既知 childIds (active + archived) を除外対象として渡し、orphan 残骸のみ sweep する
		expect(mockChildRepo.sweepOrphanChildPartitions).toHaveBeenCalledTimes(1);
		expect(mockChildRepo.sweepOrphanChildPartitions).toHaveBeenCalledWith(TENANT, [
			'100',
			'200',
			'300',
		]);
	});

	it('#3750: 児童 0 人 (childIds undefined) 時は sweep を呼ばない (Scan fallback と二重 Scan を避ける)', async () => {
		// findAllChildren / findArchivedChildren はデフォルトで空 → childIds=undefined
		await deleteTenantScopedData(TENANT);

		expect(mockChildRepo.sweepOrphanChildPartitions).not.toHaveBeenCalled();
	});

	it('#3750: orphan sweep が失敗しても他の削除をブロックしない', async () => {
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: '100' }]);
		mockChildRepo.sweepOrphanChildPartitions.mockRejectedValueOnce(new Error('scan err'));

		await expect(deleteTenantScopedData(TENANT)).resolves.toBeGreaterThanOrEqual(0);
		expect(mockChildRepo.sweepOrphanChildPartitions).toHaveBeenCalledTimes(1);
	});

	it('activities (per-child loop, #2362) / viewerTokens / cloudExports / pushSubscriptions は find+delete パターン', async () => {
		// #2362 PR-3 (ADR-0055): activities は per-child instance loop で delete される
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: '100' }, { id: '200' }]);
		mockChildActivityRepo.findActivitiesByChild
			.mockResolvedValueOnce([{ id: '1001' }, { id: '1002' }])
			.mockResolvedValueOnce([{ id: '2001' }]);
		mockViewerTokenRepo.findByTenant.mockResolvedValue([{ id: 'tk1' }]);
		mockCloudExportRepo.findByTenant.mockResolvedValue([{ id: 'ex1' }]);
		mockPushSubscriptionRepo.findByTenant.mockResolvedValue([{ endpoint: 'https://push1' }]);

		await deleteTenantScopedData(TENANT);

		// per-child activity delete: child=100 で 2 件、child=200 で 1 件 → 計 3 回
		expect(mockChildActivityRepo.findActivitiesByChild).toHaveBeenCalledWith('100', TENANT, {
			includeArchived: true,
		});
		expect(mockChildActivityRepo.findActivitiesByChild).toHaveBeenCalledWith('200', TENANT, {
			includeArchived: true,
		});
		expect(mockChildActivityRepo.deleteActivity).toHaveBeenCalledTimes(3);
		expect(mockChildActivityRepo.deleteActivity).toHaveBeenCalledWith('1001', '100', TENANT);
		expect(mockChildActivityRepo.deleteActivity).toHaveBeenCalledWith('1002', '100', TENANT);
		expect(mockChildActivityRepo.deleteActivity).toHaveBeenCalledWith('2001', '200', TENANT);
		// 旧 activity facade は呼ばれない (signature 移行確認)
		expect(mockActivityRepo.deleteActivity).not.toHaveBeenCalled();

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
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: '1', nickname: '太郎' }]);

		await deleteTenantScopedData(TENANT);

		// children テーブル自体の削除は deleteAllChildrenData の責務
		expect(mockChildRepo.deleteChild).not.toHaveBeenCalled();
		expect(mockDeleteChildFiles).not.toHaveBeenCalled();
		// ただし voice.deleteByChild は子供ごとに呼ばれる（子供に紐づくテナントスコープ扱い）
		expect(mockVoiceRepo.deleteByChild).toHaveBeenCalledWith('1', TENANT);
	});
});
