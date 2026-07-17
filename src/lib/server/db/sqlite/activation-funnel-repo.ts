// src/lib/server/db/sqlite/activation-funnel-repo.ts
// #3805: on-demand activation funnel の SQLite backend 実装。
//
// SQLite backend は単一テナント (NUC セルフホスト、children に family_id を持たない) のため、
// 家庭横断の cohort activation funnel は概念上成立しない。ops analytics は multi-tenant cloud
// (DSQL) 専用の PO KPI 機能であり、SQLite では 0 件を返す (従来 DynamoDB 未配備の dev/NUC でも
// funnel は空だったため挙動非退行)。

import type { ActivationFunnelCounts } from '../interfaces/activation-funnel-repo.interface';

export async function getActivationFunnelCounts(): Promise<ActivationFunnelCounts> {
	return { signupCount: 0, firstChildCount: 0, firstActivityCount: 0, retained7dCount: 0 };
}
