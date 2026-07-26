// src/lib/server/auth/tenant-entitlement.ts
// テナントの課金状態 (licenseStatus / tenantStatus / plan) を DB から解決する SSOT (#3963)
//
// 背景: これらの値は以前 context_token Cookie に焼き込まれていた。Cookie の TTL は
// owner で 24 時間あり、Stripe webhook / 解約 / 再開が DB を更新しても、ブラウザが
// 持つ Cookie が切れるまで UI と権限が古いまま固定された。
//   - アップグレード方向: 支払い済みの顧客が最大 24h 有料機能を使えない
//   - ダウングレード方向: 解約済みの顧客が最大 24h 有料機能を使えてしまう
//
// 対応 (#3963 案 1): token には tenantId / role / childId だけを持たせ、課金状態は
// 毎リクエスト DB から引く。リクエスト単位のキャッシュで DB アクセスは 1 回/req に抑える。

import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { getRequestContext } from '$lib/server/request-context';
import type { AuthContext } from './types';

/** context_token に焼き込まず、毎リクエスト DB から解決する部分 */
export interface TenantEntitlement {
	licenseStatus: AuthContext['licenseStatus'];
	tenantStatus: NonNullable<AuthContext['tenantStatus']>;
	plan?: string;
}

/**
 * Tenant から課金状態を導出する。
 * Stripe subscription を持たないテナントは licenseStatus=NONE (無料)。
 * subscription を持つ場合、ACTIVE / GRACE_PERIOD のみ ACTIVE 扱いとする。
 */
export function deriveTenantEntitlement(tenant: Tenant | undefined): TenantEntitlement {
	const licenseStatus: AuthContext['licenseStatus'] = tenant?.stripeSubscriptionId
		? tenant.status === SUBSCRIPTION_STATUS.ACTIVE ||
			tenant.status === SUBSCRIPTION_STATUS.GRACE_PERIOD
			? AUTH_LICENSE_STATUS.ACTIVE
			: AUTH_LICENSE_STATUS.SUSPENDED
		: AUTH_LICENSE_STATUS.NONE;

	return {
		licenseStatus,
		tenantStatus: tenant?.status ?? SUBSCRIPTION_STATUS.ACTIVE,
		plan: tenant?.plan,
	};
}

/**
 * テナントの課金状態を DB から解決する。同一リクエスト内では 1 回だけ DB を引く。
 *
 * **解決に失敗した場合は `null` を返す (fail-closed)。** 呼び出し側は context を
 * 発行してはならない。DB 障害時に古い Cookie の値で有料機能を通し続けるのは
 * 本 Issue が塞ごうとしている挙動そのものであるため、握り潰さない (ADR-0061)。
 */
export async function resolveTenantEntitlement(
	tenantId: string,
): Promise<TenantEntitlement | null> {
	const cache = getRequestContext()?.tenantEntitlementCache;
	const cached = cache?.get(tenantId);
	if (cached) return cached;

	try {
		const tenant = await getRepos().auth.findTenantById(tenantId);
		const entitlement = deriveTenantEntitlement(tenant);
		cache?.set(tenantId, entitlement);
		return entitlement;
	} catch (e) {
		logger.error('[AUTH] Failed to resolve tenant entitlement from DB', {
			error: e instanceof Error ? e.message : String(e),
			context: { tenantId },
		});
		return null;
	}
}
