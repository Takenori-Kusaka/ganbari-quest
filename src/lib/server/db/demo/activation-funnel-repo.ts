// src/lib/server/db/demo/activation-funnel-repo.ts
// #3805 / ADR-0048: on-demand activation funnel の demo backend stub。
//
// demo Lambda は匿名 (AUTH_MODE=anonymous) の stateless fixture provider で ops analytics は
// 到達しない。cross-tenant KPI は demo の責務外のため 0 件を返す (他 demo repo と同じ stub 方針)。

import type { ActivationFunnelCounts } from '../interfaces/activation-funnel-repo.interface';

export async function getActivationFunnelCounts(): Promise<ActivationFunnelCounts> {
	return { signupCount: 0, firstChildCount: 0, firstActivityCount: 0, retained7dCount: 0 };
}
