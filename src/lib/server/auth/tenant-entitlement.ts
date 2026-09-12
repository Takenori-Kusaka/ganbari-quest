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

import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { deriveLicenseStatus } from '$lib/domain/contract-state';
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
	// #4704: 判定規則は domain leaf (`deriveLicenseStatus`) が SSOT。受諾 txn (repo 層) も
	// 同じ関数を読むため、規則の写しが 2 つに分かれない。
	const licenseStatus: AuthContext['licenseStatus'] = deriveLicenseStatus({
		status: tenant?.status,
		stripeSubscriptionId: tenant?.stripeSubscriptionId,
	});

	return {
		licenseStatus,
		tenantStatus: tenant?.status ?? SUBSCRIPTION_STATUS.ACTIVE,
		plan: tenant?.plan,
		// #4585-2: `status` 単独では S4 停止 (契約が残る) と S5 契約終了 (解約確定) を区別できない
		// (contract-state-matrix §4)。区別できないと「解約したのか、支払いが止まっているだけか」で
		// 挙動を変えられないため、既に読んでいる同じ行から契約の有無も持ち回る (追加クエリなし)。
		stripeSubscriptionId: tenant?.stripeSubscriptionId ?? null,
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
 * `findTenantById` を最大 1 回だけリトライする (#4918)。
 *
 * 背景: 本番で warm Lambda container が「接続待ちの 5 秒 timeout ではなく 20〜80ms で
 * 即失敗する」DB 解決失敗を 4 リクエスト連続で起こした。直後のリクエストは正常だった
 * ことから、warm container が保持していた個々の物理接続 (失効 IAM token / 切断済み
 * ソケット等) が原因の一過性障害だったと推定される。
 *
 * `node-postgres` の `Pool` はクエリ失敗時にそのクライアントをプールへ返さず破棄する
 * (デフォルト挙動)。加えて DSQL connector は**新規物理接続ごとに新しい IAM token を
 * 発行する** (`dsql/connection.ts` 冒頭コメント)。したがって 1 回リトライするだけで、
 * 失敗した接続がプールから自然に入れ替わり、健全な接続 (新しい token) で再試行できる。
 * DSQL 固有の pool reset をここに書く必要はない — backend 抽象 (`IAuthRepo`) を壊さず、
 * `Pool` の標準挙動に乗るだけで自己修復する。
 */
async function findTenantByIdWithRetry(tenantId: string): Promise<Tenant | undefined> {
	try {
		return await getRepos().auth.findTenantById(tenantId);
	} catch (firstError) {
		logger.warn(
			`[AUTH] ${TenantEntitlementUnavailableError.ALERT_KIND}-retry: first attempt failed, retrying once`,
			{
				error: firstError instanceof Error ? firstError.message : String(firstError),
				context: { tenantId },
			},
		);
		// 2 回目も失敗したら呼び出し元 (resolveTenantEntitlement) の catch へ委ねる。
		return getRepos().auth.findTenantById(tenantId);
	}
}

/**
 * テナントの課金状態を DB から解決する。同一リクエスト内では 1 回だけ DB を引く。
 *
 * **解決に失敗した場合は `TenantEntitlementUnavailableError` を throw する (fail-closed)。**
 * 呼び出し側は context を発行してはならない。DB 障害時に古い Cookie の値で有料機能を
 * 通し続けるのは本 Issue が塞ごうとしている挙動そのものであるため、握り潰さない。
 *
 * 解決自体は `findTenantByIdWithRetry` が一過性失敗を 1 回だけ自己修復する (#4918)。
 */
export async function resolveTenantEntitlement(tenantId: string): Promise<TenantEntitlement> {
	const cache = getRequestContext()?.tenantEntitlementCache;
	const cached = cache?.get(tenantId);
	if (cached) return cached;

	try {
		const tenant = await findTenantByIdWithRetry(tenantId);
		const entitlement = deriveTenantEntitlement(tenant);
		cache?.set(tenantId, entitlement);
		return entitlement;
	} catch (e) {
		// #3998 / #4918: Lambda 上で logger が CloudWatch に書くのは console 出力だけで、
		// 以前は `context` に入れた cause がそこに乗っていなかった (logger.ts 側で修正済)。
		// kind を message に含めないと Logs Insights から `auth-entitlement-db-unavailable`
		// で辿れる行が「503 を返した側」だけになるため、DB 解決失敗そのものの行にも
		// kind を持たせる。`error` には 2 回目 (リトライ後) の失敗原因が入る。
		logger.error(
			`[AUTH] ${TenantEntitlementUnavailableError.ALERT_KIND}: Failed to resolve tenant entitlement from DB`,
			{
				error: e instanceof Error ? e.message : String(e),
				context: { kind: TenantEntitlementUnavailableError.ALERT_KIND, tenantId },
			},
		);
		throw new TenantEntitlementUnavailableError(tenantId, e);
	}
}
