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
import type { AuthContext, TenantEntitlement } from './types';

export type { TenantEntitlement };

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
 * DB から課金状態を解決できなかったことを表す。
 *
 * `null` (= 権限なし) と区別できる型にしているのは 2 つの理由による。
 *   1. **UX**: 「DB 障害で剥奪」をログイン画面へのリダイレクトで表現すると、
 *      ユーザーは「ログアウトさせられた / アカウントが消えた」と誤解する。
 *      hooks.server.ts はこの型を捕捉して 503「一時的な障害」を返す。
 *   2. **可観測性**: 「DB 障害で剥奪」と「正当に無権限」が同じ見え方だと、
 *      incident 時に原因の切り分けができない。`ALERT_KIND` で検索可能にする。
 */
export class TenantEntitlementUnavailableError extends Error {
	/** CloudWatch Logs Insights / Discord alert の検索 key */
	static readonly ALERT_KIND = 'auth-entitlement-db-unavailable';

	constructor(
		readonly tenantId: string,
		/** DB 側の原因 (Error.cause は型が緩いため専用フィールドで保持する) */
		readonly dbError: unknown,
	) {
		super(`Failed to resolve tenant entitlement from DB: tenantId=${tenantId}`);
		this.name = 'TenantEntitlementUnavailableError';
	}
}

/**
 * テナントの課金状態を DB から解決する。同一リクエスト内では 1 回だけ DB を引く。
 *
 * **解決に失敗した場合は `TenantEntitlementUnavailableError` を throw する (fail-closed)。**
 * 呼び出し側は context を発行してはならない。DB 障害時に古い Cookie の値で有料機能を
 * 通し続けるのは本 Issue が塞ごうとしている挙動そのものであるため、握り潰さない。
 */
export async function resolveTenantEntitlement(tenantId: string): Promise<TenantEntitlement> {
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
			context: { kind: TenantEntitlementUnavailableError.ALERT_KIND, tenantId },
		});
		throw new TenantEntitlementUnavailableError(tenantId, e);
	}
}
