// tests/unit/services/cron-idempotency.test.ts
// #1377 (#1374 Sub A-3 Common AC): 既存 3 cron service の idempotency 検証
//
// 検証範囲:
//   - expireLicenseKeys / cleanupExpiredData / processTrialNotifications を
//     2 回連続実行しても、副作用が「2 回目以降に増えない」こと
//   - すなわち N 回呼んでも DB / 外部 API 呼び出し回数は 1 回分の sweep に近づく
//
// 戦略:
//   各 service は repository / 外部サービスに副作用を委譲しているため、
//   - 1 回目: 「対象データあり」を mock し、副作用 mock の呼び出し回数を記録
//   - 2 回目: 「対象データなし」(= 1 回目で処理済みの状態) を mock し、副作用 mock が
//     呼ばれないことを検証
//   この二段階で「冪等性 = 2 回目は何もしない」を回帰テストする。
//
// Pre-PMF 配慮 (ADR-0010):
//   実 DB を立てた end-to-end の冪等性検証は E2E 層で行う (cron/age-recalc.spec.ts に
//   既存パターンあり)。本ユニットテストは service 層の挙動契約のみを保証する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		critical: vi.fn(),
		request: vi.fn(),
		requestError: vi.fn(),
	},
}));

// ============================================================
// expireLicenseKeys (license-expire endpoint)
// ============================================================

describe('#1377 idempotency — expireLicenseKeys', () => {
	const listActiveExpiredKeysMock = vi.fn();
	const revokeLicenseKeyMock = vi.fn();

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.doMock('$lib/server/db/factory', () => ({
			getRepos: () => ({
				auth: {
					listActiveExpiredKeys: listActiveExpiredKeysMock,
				},
			}),
		}));
		// revokeLicenseKey は同じファイル内 export なので spyOn できないため、
		// 同モジュール内の関数を直接 mock するために再エクスポートを別経路で差し替える。
		vi.doMock('$lib/server/services/license-key-service', async () => {
			const actual = await vi.importActual<
				typeof import('../../../src/lib/server/services/license-key-service')
			>('../../../src/lib/server/services/license-key-service');
			return {
				...actual,
				revokeLicenseKey: revokeLicenseKeyMock,
			};
		});
	});

	afterEach(() => {
		vi.doUnmock('$lib/server/db/factory');
		vi.doUnmock('$lib/server/services/license-key-service');
	});

	it('1 回目で全件 revoke、2 回目は対象なしで revoke 0 (副作用増加なし)', async () => {
		// 1 回目: 期限切れ 2 件
		listActiveExpiredKeysMock.mockResolvedValueOnce([
			{ licenseKey: 'lk_aaa1', expiresAt: '2024-01-01T00:00:00Z' },
			{ licenseKey: 'lk_bbb2', expiresAt: '2024-01-02T00:00:00Z' },
		]);
		// 2 回目: 1 回目で revoke 済みなので空
		listActiveExpiredKeysMock.mockResolvedValueOnce([]);
		revokeLicenseKeyMock.mockResolvedValue({ ok: true });

		// 対象モジュールを動的に import (mock 適用後に評価される)
		const { expireLicenseKeys } = await import(
			'../../../src/lib/server/services/license-key-service'
		);

		const r1 = await expireLicenseKeys();
		expect(r1.scanned).toBe(2);

		const r2 = await expireLicenseKeys();
		expect(r2.scanned).toBe(0);
		expect(r2.revoked).toBe(0);
		expect(r2.failures).toEqual([]);
	});

	it('dryRun=true は revoke を呼ばない (副作用なし保証)', async () => {
		listActiveExpiredKeysMock.mockResolvedValueOnce([
			{ licenseKey: 'lk_dry1', expiresAt: '2024-01-01T00:00:00Z' },
		]);

		const { expireLicenseKeys } = await import(
			'../../../src/lib/server/services/license-key-service'
		);

		const r = await expireLicenseKeys({ dryRun: true });
		expect(r.scanned).toBe(1);
		expect(r.revoked).toBe(0);
		expect(revokeLicenseKeyMock).not.toHaveBeenCalled();
	});
});

// ============================================================
// cleanupExpiredData (retention-cleanup endpoint)
// ============================================================

describe('#1377 idempotency — cleanupExpiredData', () => {
	const listAllTenantsMock = vi.fn();
	const findAllChildrenMock = vi.fn();
	const deleteActivityLogsMock = vi.fn();
	const deletePointLedgerMock = vi.fn();
	const deleteLoginBonusesMock = vi.fn();

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();

		vi.doMock('$lib/server/auth/factory', () => ({
			getAuthMode: () => 'cognito',
		}));
		vi.doMock('$lib/server/request-context', () => ({
			getRequestContext: () => undefined,
			buildPlanTierCacheKey: (tenantId: string, licenseStatus: string, planId?: string) =>
				`${tenantId}:${licenseStatus}:${planId ?? ''}`,
		}));
		vi.doMock('$lib/server/services/trial-service', () => ({
			getTrialStatus: vi.fn().mockResolvedValue({
				isTrialActive: false,
				trialEndDate: null,
				trialTier: null,
			}),
		}));
		vi.doMock('$lib/server/db/factory', () => ({
			getRepos: () => ({
				auth: { listAllTenants: listAllTenantsMock },
				child: { findAllChildren: findAllChildrenMock },
				activity: { deleteActivityLogsBeforeDate: deleteActivityLogsMock },
				point: { deletePointLedgerBeforeDate: deletePointLedgerMock },
				loginBonus: { deleteLoginBonusesBeforeDate: deleteLoginBonusesMock },
			}),
		}));
	});

	afterEach(() => {
		vi.doUnmock('$lib/server/auth/factory');
		vi.doUnmock('$lib/server/request-context');
		vi.doUnmock('$lib/server/services/trial-service');
		vi.doUnmock('$lib/server/db/factory');
	});

	it('2 回連続実行で副作用 (delete 呼び出し) 件数が単調減少する', async () => {
		// 1 回目: free tenant 1 件 / 子供 1 名 / 削除 5 件
		listAllTenantsMock.mockResolvedValueOnce([
			{ tenantId: 't-1', plan: null, licenseStatus: 'none' },
		]);
		findAllChildrenMock.mockResolvedValueOnce([{ id: 1, tenantId: 't-1' }]);
		deleteActivityLogsMock.mockResolvedValueOnce(5);
		deletePointLedgerMock.mockResolvedValueOnce(2);
		deleteLoginBonusesMock.mockResolvedValueOnce(1);

		// 2 回目: 同じ tenant / 子供だが、削除対象なし (1 回目で sweep 済み)
		listAllTenantsMock.mockResolvedValueOnce([
			{ tenantId: 't-1', plan: null, licenseStatus: 'none' },
		]);
		findAllChildrenMock.mockResolvedValueOnce([{ id: 1, tenantId: 't-1' }]);
		deleteActivityLogsMock.mockResolvedValueOnce(0);
		deletePointLedgerMock.mockResolvedValueOnce(0);
		deleteLoginBonusesMock.mockResolvedValueOnce(0);

		const { cleanupExpiredData } = await import(
			'../../../src/lib/server/services/retention-cleanup-service'
		);

		const r1 = await cleanupExpiredData();
		expect(r1.activityLogsDeleted).toBe(5);

		const r2 = await cleanupExpiredData();
		// 冪等: 2 回目は削除 0 件 (= 1 回目に sweep 済み)
		expect(r2.activityLogsDeleted).toBe(0);
		expect(r2.pointLedgerDeleted).toBe(0);
		expect(r2.loginBonusesDeleted).toBe(0);
	});

	it('dryRun=true は delete 関数を呼ばない (副作用なし保証)', async () => {
		listAllTenantsMock.mockResolvedValueOnce([
			{ tenantId: 't-1', plan: null, licenseStatus: 'none' },
		]);
		findAllChildrenMock.mockResolvedValueOnce([{ id: 1, tenantId: 't-1' }]);

		const { cleanupExpiredData } = await import(
			'../../../src/lib/server/services/retention-cleanup-service'
		);

		await cleanupExpiredData({ dryRun: true });
		expect(deleteActivityLogsMock).not.toHaveBeenCalled();
		expect(deletePointLedgerMock).not.toHaveBeenCalled();
		expect(deleteLoginBonusesMock).not.toHaveBeenCalled();
	});
});

// ============================================================
// processTrialNotifications (trial-notifications endpoint)
// ============================================================

describe('#1377 idempotency — processTrialNotifications', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('対象テナントが空なら sent/skipped/errors すべて 0 (副作用なし)', async () => {
		const { processTrialNotifications } = await import(
			'../../../src/lib/server/services/trial-notification-service'
		);
		const r = await processTrialNotifications([]);
		expect(r).toEqual({ sent: 0, skipped: 0, errors: 0 });
	});

	// NOTE:
	// 本格的な「2 回目は通知が来ない」検証は E2E (実 DB + email mock) で行う。
	// service 層の冪等性は処理ロジック自体ではなく、`getNotificationSchedule()` が
	// 「日付閾値外のテナントは null を返す」設計に依存する。null を返すかは
	// trial-service の純粋関数で決まり、副作用は伴わない。
	// このため本ユニットでは「対象 0 件 → 副作用 0 件」の最小契約のみを保証し、
	// 多重通知抑制の真の検証は trial-notification-service.test.ts と E2E に委譲する。
});
