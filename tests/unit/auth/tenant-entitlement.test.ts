// tests/unit/auth/tenant-entitlement.test.ts
// #3963: 課金状態 (licenseStatus / tenantStatus / plan) を context_token に焼き込まず
// 毎リクエスト DB から解決する SSOT のテスト。
//
// テスト観点:
// - deriveTenantEntitlement: Tenant.status → licenseStatus の正規化が全 status で正しいこと
//   (auth-license-status.ts のマッピング表が壊れると課金・権限の両方が壊れる)
// - resolveTenantEntitlement: 同一リクエスト内で DB を 1 回だけ引くこと (AC4)
// - resolveTenantEntitlement: DB 障害時に fail-closed で null を返すこと
//   (握り潰して古い値を返すと本 Issue の再発そのものになる)
// - invalidateRequestCaches: 解約 / 再開の書き込み直後に同一リクエスト内でも新しい値になること

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_LICENSE_STATUS } from '../../../src/lib/domain/constants/auth-license-status';
import {
	ALL_SUBSCRIPTION_STATUSES,
	SUBSCRIPTION_STATUS,
} from '../../../src/lib/domain/constants/subscription-status';
import type { Tenant } from '../../../src/lib/server/auth/entities';

// ---------- mocks ----------

const findTenantById = vi.fn();
vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ auth: { findTenantById } }),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { deriveTenantEntitlement, resolveTenantEntitlement } = await import(
	'../../../src/lib/server/auth/tenant-entitlement'
);
const { runWithRequestContext, invalidateRequestCaches } = await import(
	'../../../src/lib/server/request-context'
);

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
	return {
		tenantId: 't-1',
		name: 'テスト家族',
		ownerId: 'u-1',
		status: SUBSCRIPTION_STATUS.ACTIVE,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

beforeEach(() => {
	findTenantById.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('deriveTenantEntitlement (#3963)', () => {
	it('subscription を持たないテナントは licenseStatus=none (無料)', () => {
		const result = deriveTenantEntitlement(makeTenant());
		expect(result.licenseStatus).toBe(AUTH_LICENSE_STATUS.NONE);
	});

	it('tenant が undefined でも落ちず、none / active を返す', () => {
		const result = deriveTenantEntitlement(undefined);
		expect(result).toEqual({
			licenseStatus: AUTH_LICENSE_STATUS.NONE,
			tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
			plan: undefined,
		});
	});

	// active / grace_period のみ機能利用可 (ENTITLED_SUBSCRIPTION_STATUSES と整合)
	it.each([
		[SUBSCRIPTION_STATUS.ACTIVE, AUTH_LICENSE_STATUS.ACTIVE],
		[SUBSCRIPTION_STATUS.GRACE_PERIOD, AUTH_LICENSE_STATUS.ACTIVE],
		[SUBSCRIPTION_STATUS.SUSPENDED, AUTH_LICENSE_STATUS.SUSPENDED],
		[SUBSCRIPTION_STATUS.TERMINATED, AUTH_LICENSE_STATUS.SUSPENDED],
	])('subscription 有 + status=%s → licenseStatus=%s', (status, expected) => {
		const result = deriveTenantEntitlement(
			makeTenant({ status, stripeSubscriptionId: 'sub_1', plan: 'monthly' }),
		);
		expect(result.licenseStatus).toBe(expected);
		expect(result.tenantStatus).toBe(status);
		expect(result.plan).toBe('monthly');
	});

	// 新しい status が追加されたときに黙って active 扱いされないことを固定する
	it('全 SubscriptionStatus について licenseStatus が active か suspended に定まる', () => {
		for (const status of ALL_SUBSCRIPTION_STATUSES) {
			const result = deriveTenantEntitlement(makeTenant({ status, stripeSubscriptionId: 'sub_1' }));
			expect([AUTH_LICENSE_STATUS.ACTIVE, AUTH_LICENSE_STATUS.SUSPENDED]).toContain(
				result.licenseStatus,
			);
		}
	});
});

describe('resolveTenantEntitlement (#3963)', () => {
	it('DB から解決した課金状態を返す', async () => {
		findTenantById.mockResolvedValue(
			makeTenant({ stripeSubscriptionId: 'sub_1', plan: 'family-monthly' }),
		);

		const result = await runWithRequestContext(() => resolveTenantEntitlement('t-1'));

		expect(result).toEqual({
			licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
			tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
			plan: 'family-monthly',
		});
	});

	// AC4: context_token から課金状態を外したことで増える DB アクセスが
	// リクエスト単位に抑えられていること
	it('同一リクエスト内では DB を 1 回だけ引く', async () => {
		findTenantById.mockResolvedValue(makeTenant({ stripeSubscriptionId: 'sub_1' }));

		await runWithRequestContext(async () => {
			await resolveTenantEntitlement('t-1');
			await resolveTenantEntitlement('t-1');
			await resolveTenantEntitlement('t-1');
		});

		expect(findTenantById).toHaveBeenCalledTimes(1);
	});

	it('テナントが異なればそれぞれ DB を引く', async () => {
		findTenantById.mockResolvedValue(makeTenant({ stripeSubscriptionId: 'sub_1' }));

		await runWithRequestContext(async () => {
			await resolveTenantEntitlement('t-1');
			await resolveTenantEntitlement('t-2');
		});

		expect(findTenantById).toHaveBeenCalledTimes(2);
	});

	// リクエストを跨いだキャッシュは持たない = webhook が DB を更新すれば次リクエストで即反映
	it('リクエストを跨ぐとキャッシュされず、DB の変更が次リクエストで反映される', async () => {
		findTenantById.mockResolvedValueOnce(
			makeTenant({ status: SUBSCRIPTION_STATUS.ACTIVE, stripeSubscriptionId: 'sub_1' }),
		);
		const first = await runWithRequestContext(() => resolveTenantEntitlement('t-1'));
		expect(first?.licenseStatus).toBe(AUTH_LICENSE_STATUS.ACTIVE);

		// 解約により DB 側が suspended になった
		findTenantById.mockResolvedValueOnce(
			makeTenant({ status: SUBSCRIPTION_STATUS.SUSPENDED, stripeSubscriptionId: 'sub_1' }),
		);
		const second = await runWithRequestContext(() => resolveTenantEntitlement('t-1'));

		expect(second?.licenseStatus).toBe(AUTH_LICENSE_STATUS.SUSPENDED);
		expect(findTenantById).toHaveBeenCalledTimes(2);
	});

	// 解約 API は書き込み直後に invalidateRequestCaches を呼ぶ
	it('invalidateRequestCaches 後は同一リクエスト内でも DB を再解決する', async () => {
		findTenantById.mockResolvedValueOnce(
			makeTenant({ status: SUBSCRIPTION_STATUS.ACTIVE, stripeSubscriptionId: 'sub_1' }),
		);
		findTenantById.mockResolvedValueOnce(
			makeTenant({ status: SUBSCRIPTION_STATUS.SUSPENDED, stripeSubscriptionId: 'sub_1' }),
		);

		await runWithRequestContext(async () => {
			const before = await resolveTenantEntitlement('t-1');
			expect(before?.licenseStatus).toBe(AUTH_LICENSE_STATUS.ACTIVE);

			invalidateRequestCaches('t-1');

			const after = await resolveTenantEntitlement('t-1');
			expect(after?.licenseStatus).toBe(AUTH_LICENSE_STATUS.SUSPENDED);
		});

		expect(findTenantById).toHaveBeenCalledTimes(2);
	});

	// fail-closed: DB 障害で古い Cookie の値を通すのは本 Issue の再発そのもの
	it('DB が throw したら null を返す (fail-closed、握り潰さない)', async () => {
		findTenantById.mockRejectedValue(new Error('DSQL connection refused'));

		const result = await runWithRequestContext(() => resolveTenantEntitlement('t-1'));

		expect(result).toBeNull();
	});

	it('DB 障害の結果はキャッシュせず、次の呼び出しで再試行する', async () => {
		findTenantById.mockRejectedValueOnce(new Error('transient'));
		findTenantById.mockResolvedValueOnce(makeTenant({ stripeSubscriptionId: 'sub_1' }));

		await runWithRequestContext(async () => {
			expect(await resolveTenantEntitlement('t-1')).toBeNull();
			expect((await resolveTenantEntitlement('t-1'))?.licenseStatus).toBe(
				AUTH_LICENSE_STATUS.ACTIVE,
			);
		});

		expect(findTenantById).toHaveBeenCalledTimes(2);
	});

	// リクエストコンテキスト外 (バックグラウンドジョブ等) でも動くこと
	it('リクエストコンテキスト外でも解決できる (キャッシュなしで素通し)', async () => {
		findTenantById.mockResolvedValue(makeTenant({ stripeSubscriptionId: 'sub_1' }));

		const result = await resolveTenantEntitlement('t-1');

		expect(result?.licenseStatus).toBe(AUTH_LICENSE_STATUS.ACTIVE);
	});
});
