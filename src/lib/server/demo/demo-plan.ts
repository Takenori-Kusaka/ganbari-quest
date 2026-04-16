// src/lib/server/demo/demo-plan.ts
// #760: デモ画面で free / standard / family の各プランを切り替えて体験できる
// 仕組みを提供する。`?plan=` クエリで切替、cookie で永続化する。
//
// `plan-limit-service.ts` の `resolvePlanTier` と整合する組み合わせ:
//   - free     → licenseStatus='none',   plan=undefined
//   - standard → licenseStatus='active', plan='monthly'
//   - family   → licenseStatus='active', plan='family-monthly'
//
// デフォルトは free（サインアップ後の体験との乖離を防ぐ — #956）。

import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import type { AuthContext } from '$lib/server/auth/types';

export type DemoPlan = 'free' | 'standard' | 'family';

/** デモプラン保存用 Cookie 名 */
export const DEMO_PLAN_COOKIE = 'demo_plan';

/** デフォルトのデモプラン（最初の訪問で showcase される） */
export const DEFAULT_DEMO_PLAN: DemoPlan = 'free';

const VALID_PLANS: ReadonlySet<string> = new Set(['free', 'standard', 'family']);

/** 文字列が DemoPlan として有効かどうか */
export function isDemoPlan(value: unknown): value is DemoPlan {
	return typeof value === 'string' && VALID_PLANS.has(value);
}

/**
 * `?plan=` クエリ → cookie の優先順で現在のデモプランを解決する。
 * クエリも cookie も無ければ DEFAULT_DEMO_PLAN を返す。
 */
export function resolveDemoPlan(query: string | null, cookie: string | undefined): DemoPlan {
	if (query && isDemoPlan(query)) return query;
	if (cookie && isDemoPlan(cookie)) return cookie;
	return DEFAULT_DEMO_PLAN;
}

/**
 * デモプランに対応する licenseStatus / plan を AuthContext に適用した
 * 新しい context を返す。
 */
export function applyDemoPlanToContext(base: AuthContext, demoPlan: DemoPlan): AuthContext {
	switch (demoPlan) {
		case 'free':
			return { ...base, licenseStatus: AUTH_LICENSE_STATUS.NONE, plan: undefined };
		case 'standard':
			return {
				...base,
				licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
				plan: LICENSE_PLAN.MONTHLY,
			};
		case 'family':
			return {
				...base,
				licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
				plan: LICENSE_PLAN.FAMILY_MONTHLY,
			};
	}
}
