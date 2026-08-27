// tests/unit/services/retention-cleanup-service.test.ts
// #717, #729: 保存期間超過データの自動削除サービスのユニットテスト
//
// retention-cleanup-service は getRepos() 経由で全リポジトリを叩くため、
// ファクトリをモックして各リポジトリの戻り値を制御する。
// plan-limit-service は実物を使い、resolveFullPlanTier の trial-history 依存は
// `trialHistory` リポジトリをモックして「トライアル無し」を返す。

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// auth-mode を cognito (multi-tenant) に固定。'local' だと全テナントが family 扱いになり
// 削除対象ゼロになってしまう。
// #4723: モード判定の実体は auth-mode.ts (factory は re-export)。plan-limit-service など
// 直接 auth-mode を import する側にも同じ値が見えるよう、両方を差し替える。
vi.mock('$lib/server/auth/auth-mode', () => ({
	getAuthMode: () => 'cognito',
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
}));

// request-context は無効化（キャッシュなし）
vi.mock('$lib/server/request-context', () => ({
	getRequestContext: () => undefined,
	buildPlanTierCacheKey: (tenantId: string, licenseStatus: string, planId?: string) =>
		`${tenantId}:${licenseStatus}:${planId ?? ''}`,
}));

// trial-service は「トライアル無し」を固定で返す
vi.mock('$lib/server/services/trial-service', () => ({
	getTrialStatus: vi.fn().mockResolvedValue({
		isTrialActive: false,
		trialEndDate: null,
		trialTier: null,
	}),
}));

// リポジトリのモック実装
const mockListAllTenants = vi.fn();
const mockFindAllChildren = vi.fn();
const mockDeleteActivityLogsBeforeDate = vi.fn();
const mockDeletePointLedgerBeforeDate = vi.fn();
const mockDeleteStatusHistoryBeforeDate = vi.fn(); // #3518-2
const mockDeleteWebhookEventsOlderThan = vi.fn(); // #3985

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			listAllTenants: mockListAllTenants,
		},
		child: {
			findAllChildren: mockFindAllChildren,
		},
		activity: {
			deleteActivityLogsBeforeDate: mockDeleteActivityLogsBeforeDate,
		},
		point: {
			deletePointLedgerBeforeDate: mockDeletePointLedgerBeforeDate,
		},
		status: {
			deleteStatusHistoryBeforeDate: mockDeleteStatusHistoryBeforeDate,
		},
		// #3985: Stripe webhook dedup 台帳の 30 日 retention (tenant 非依存のグローバル表)
		webhookEvent: {
			deleteOlderThan: mockDeleteWebhookEventsOlderThan,
		},
	}),
}));

import { cleanupExpiredData } from '../../../src/lib/server/services/retention-cleanup-service';

const TODAY = new Date();

function makeTenant(
	overrides: Partial<{
		tenantId: string;
		status: string;
		stripeSubscriptionId?: string;
		plan?: string;
	}>,
) {
	return {
		tenantId: overrides.tenantId ?? 't-1',
		name: 'Test Tenant',
		ownerId: 'u-1',
		status: overrides.status ?? 'active',
		stripeSubscriptionId: overrides.stripeSubscriptionId,
		plan: overrides.plan,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockListAllTenants.mockResolvedValue([]);
	mockFindAllChildren.mockResolvedValue([]);
	mockDeleteActivityLogsBeforeDate.mockResolvedValue(0);
	mockDeletePointLedgerBeforeDate.mockResolvedValue(0);
	mockDeleteStatusHistoryBeforeDate.mockResolvedValue(0);
	mockDeleteWebhookEventsOlderThan.mockResolvedValue(0);
});

// ==========================================================
// #3985: Stripe webhook dedup 台帳の 30 日 retention
// ==========================================================

describe('stripe_webhook_events retention (#3985)', () => {
	it('30 日より古い webhook dedup row を削除し、件数を結果に載せる', async () => {
		mockDeleteWebhookEventsOlderThan.mockResolvedValue(7);

		const result = await cleanupExpiredData();

		expect(mockDeleteWebhookEventsOlderThan).toHaveBeenCalledTimes(1);
		const cutoff = new Date(mockDeleteWebhookEventsOlderThan.mock.calls[0]?.[0] as string);
		const days = (Date.now() - cutoff.getTime()) / 86_400_000;
		// Stripe Events API の保持期間 (30 日) と同期。それ以上保持しても replay が来ない
		expect(days).toBeGreaterThan(29.9);
		expect(days).toBeLessThan(30.1);
		expect(result.webhookEventsDeleted).toBe(7);
	});

	it('dryRun では削除しない', async () => {
		const result = await cleanupExpiredData({ dryRun: true });

		expect(mockDeleteWebhookEventsOlderThan).not.toHaveBeenCalled();
		expect(result.webhookEventsDeleted).toBe(0);
	});

	it('webhook 台帳の削除失敗はテナント処理を巻き込まず errors に記録される', async () => {
		mockDeleteWebhookEventsOlderThan.mockRejectedValue(new Error('table locked'));

		const result = await cleanupExpiredData();

		expect(result.webhookEventsDeleted).toBe(0);
		expect(result.errors).toContainEqual({ tenantId: '(global)', error: 'table locked' });
	});
});

// ==========================================================
// 基本: 空の状態
// ==========================================================

describe('cleanupExpiredData - 空の状態', () => {
	it('テナントが 0 件 → 全カウント 0', async () => {
		const result = await cleanupExpiredData();
		expect(result.tenantsProcessed).toBe(0);
		expect(result.tenantsSkipped).toBe(0);
		expect(result.childrenProcessed).toBe(0);
		expect(result.activityLogsDeleted).toBe(0);
		expect(result.errors).toEqual([]);
	});
});

// ==========================================================
// プランティア別の挙動
// ==========================================================

describe('cleanupExpiredData - プランティア別', () => {
	it('family プラン → 削除スキップ、tenantsSkipped++', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't-family',
				status: 'active',
				stripeSubscriptionId: 'sub_123',
				plan: 'family-monthly',
			}),
		]);
		mockFindAllChildren.mockResolvedValue([{ id: '1' }]);

		const result = await cleanupExpiredData();

		expect(result.tenantsProcessed).toBe(0);
		expect(result.tenantsSkipped).toBe(1);
		expect(mockDeleteActivityLogsBeforeDate).not.toHaveBeenCalled();
		expect(mockDeletePointLedgerBeforeDate).not.toHaveBeenCalled();
		// #3518-2: family (無制限) は status_history も剪定しない
		expect(mockDeleteStatusHistoryBeforeDate).not.toHaveBeenCalled();
	});

	it('free プラン → 90 日前より古いデータを削除', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't-free',
				status: 'active',
				// stripeSubscriptionId なし = licenseStatus='none' = free
			}),
		]);
		mockFindAllChildren.mockResolvedValue([{ id: '1' }, { id: '2' }]);
		mockDeleteActivityLogsBeforeDate.mockResolvedValue(10);
		mockDeletePointLedgerBeforeDate.mockResolvedValue(5);
		mockDeleteStatusHistoryBeforeDate.mockResolvedValue(40); // #3518-2: daily decay 由来の最大母数

		const result = await cleanupExpiredData();

		expect(result.tenantsProcessed).toBe(1);
		expect(result.childrenProcessed).toBe(2);
		// 2 children × 10 logs = 20
		expect(result.activityLogsDeleted).toBe(20);
		expect(result.pointLedgerDeleted).toBe(10);
		// #3518-2: 2 children × 40 = 80、cutoffDate + tenantId で呼ばれる
		expect(result.statusHistoryDeleted).toBe(80);
		expect(mockDeleteStatusHistoryBeforeDate).toHaveBeenCalledTimes(2);
		const shCall = mockDeleteStatusHistoryBeforeDate.mock.calls[0];
		if (!shCall) throw new Error('no status history call recorded');
		expect(shCall[0]).toBe('1'); // childId
		expect(shCall[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // cutoffDate
		expect(shCall[2]).toBe('t-free'); // tenantId

		// cutoffDate が 90 日前近辺であることを確認（範囲で）
		expect(mockDeleteActivityLogsBeforeDate).toHaveBeenCalledTimes(2);
		const callArgs = mockDeleteActivityLogsBeforeDate.mock.calls[0];
		if (!callArgs) throw new Error('no call recorded');
		expect(callArgs[0]).toBe('1'); // childId
		const cutoffDate = callArgs[1] as string;
		expect(cutoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const cutoffDays = Math.round(
			(TODAY.getTime() - new Date(cutoffDate).getTime()) / (1000 * 60 * 60 * 24),
		);
		expect(cutoffDays).toBeGreaterThanOrEqual(89);
		expect(cutoffDays).toBeLessThanOrEqual(91);
		expect(callArgs[2]).toBe('t-free'); // tenantId
	});

	it('standard プラン → 365 日前より古いデータを削除', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't-std',
				status: 'active',
				stripeSubscriptionId: 'sub_abc',
				plan: 'monthly',
			}),
		]);
		mockFindAllChildren.mockResolvedValue([{ id: '1' }]);
		mockDeleteActivityLogsBeforeDate.mockResolvedValue(7);

		const result = await cleanupExpiredData();

		expect(result.tenantsProcessed).toBe(1);
		expect(result.activityLogsDeleted).toBe(7);
		const firstCall = mockDeleteActivityLogsBeforeDate.mock.calls[0];
		if (!firstCall) throw new Error('no call recorded');
		const cutoffDate = firstCall[1] as string;
		const cutoffDays = Math.round(
			(TODAY.getTime() - new Date(cutoffDate).getTime()) / (1000 * 60 * 60 * 24),
		);
		expect(cutoffDays).toBeGreaterThanOrEqual(364);
		expect(cutoffDays).toBeLessThanOrEqual(366);
	});
});

// ==========================================================
// dry-run モード
// ==========================================================

describe('cleanupExpiredData - dry-run', () => {
	it('dryRun=true → 削除関数を呼ばない、children はカウントする', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant({ tenantId: 't-free', status: 'active' })]);
		mockFindAllChildren.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);

		const result = await cleanupExpiredData({ dryRun: true });

		expect(result.tenantsProcessed).toBe(1);
		expect(result.childrenProcessed).toBe(3);
		expect(mockDeleteActivityLogsBeforeDate).not.toHaveBeenCalled();
		expect(mockDeletePointLedgerBeforeDate).not.toHaveBeenCalled();
		// #3518-2: dryRun は status_history も削除しない
		expect(mockDeleteStatusHistoryBeforeDate).not.toHaveBeenCalled();
	});
});

// ==========================================================
// エラーハンドリング
// ==========================================================

describe('cleanupExpiredData - エラー処理', () => {
	it('1 テナントの失敗が他のテナントに波及しない', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({ tenantId: 't-error', status: 'active' }),
			makeTenant({ tenantId: 't-ok', status: 'active' }),
		]);
		// t-error のみ findAllChildren が失敗
		mockFindAllChildren.mockImplementation(async (tenantId: string) => {
			if (tenantId === 't-error') {
				throw new Error('DB connection lost');
			}
			return [{ id: '1' }];
		});
		mockDeleteActivityLogsBeforeDate.mockResolvedValue(2);

		const result = await cleanupExpiredData();

		expect(result.tenantsProcessed).toBe(1); // t-ok
		expect(result.tenantsSkipped).toBe(1); // t-error
		expect(result.errors).toHaveLength(1);
		const firstError = result.errors[0];
		if (!firstError) throw new Error('expected one error');
		expect(firstError.tenantId).toBe('t-error');
		expect(firstError.error).toContain('DB connection lost');
		expect(result.activityLogsDeleted).toBe(2); // t-ok 分のみ
	});

	it('listAllTenants が失敗 → throw', async () => {
		mockListAllTenants.mockRejectedValue(new Error('list tenants failed'));
		await expect(cleanupExpiredData()).rejects.toThrow('list tenants failed');
	});
});

// ==========================================================
// licenseStatus 導出ロジック
// ==========================================================

describe('cleanupExpiredData - licenseStatus 導出', () => {
	it('stripeSubscriptionId なし → free プラン (licenseStatus=none)', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant({ tenantId: 't-1', status: 'active' })]);
		mockFindAllChildren.mockResolvedValue([{ id: '1' }]);

		await cleanupExpiredData();

		// free プラン (90日) で呼ばれたことを確認
		const cutoffDate = mockDeleteActivityLogsBeforeDate.mock.calls[0]?.[1] as string;
		expect(cutoffDate).toBeDefined();
		const days = Math.round(
			(TODAY.getTime() - new Date(cutoffDate).getTime()) / (1000 * 60 * 60 * 24),
		);
		expect(days).toBeGreaterThanOrEqual(89);
		expect(days).toBeLessThanOrEqual(91);
	});

	it('stripeSubscriptionId あり + status=suspended → suspended (free 扱い)', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't-suspended',
				status: 'suspended',
				stripeSubscriptionId: 'sub_x',
				plan: 'family-monthly',
			}),
		]);
		mockFindAllChildren.mockResolvedValue([{ id: '1' }]);

		await cleanupExpiredData();

		// family プランだが suspended → licenseStatus=suspended → free扱い → 90日で削除実行
		expect(mockDeleteActivityLogsBeforeDate).toHaveBeenCalled();
		const suspendedCall = mockDeleteActivityLogsBeforeDate.mock.calls[0];
		if (!suspendedCall) throw new Error('no call recorded');
		const cutoffDate = suspendedCall[1] as string;
		const days = Math.round(
			(TODAY.getTime() - new Date(cutoffDate).getTime()) / (1000 * 60 * 60 * 24),
		);
		expect(days).toBeGreaterThanOrEqual(89);
		expect(days).toBeLessThanOrEqual(91);
	});

	it('stripeSubscriptionId あり + status=grace_period → active', async () => {
		mockListAllTenants.mockResolvedValue([
			makeTenant({
				tenantId: 't-grace',
				status: 'grace_period',
				stripeSubscriptionId: 'sub_y',
				plan: 'family-yearly',
			}),
		]);
		mockFindAllChildren.mockResolvedValue([{ id: '1' }]);

		const result = await cleanupExpiredData();

		// grace_period + family-yearly → family tier → skip
		expect(result.tenantsSkipped).toBe(1);
		expect(mockDeleteActivityLogsBeforeDate).not.toHaveBeenCalled();
	});
});
