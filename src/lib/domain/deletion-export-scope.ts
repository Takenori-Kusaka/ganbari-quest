// src/lib/domain/deletion-export-scope.ts
// 退会前エクスポートのプラン別スコープ (#740 / #4472)
//
// 実データ生成は server 側 (`$lib/server/services/deletion-export-service`) が担うが、
// 退会画面は「何が入るか」を押す前に説明する必要があるため、スコープ判定だけを
// client からも import できる domain leaf に置く (server 実装との二重定義を作らない)。

import type { PlanTier } from './constants/plan-tier';

export type ExportScope = 'minimal' | 'full' | 'family';

/** プランティアからエクスポートスコープを判定する。 */
export function resolveExportScope(planTier: PlanTier): ExportScope {
	switch (planTier) {
		case 'family':
			return 'family';
		case 'standard':
			return 'full';
		default:
			return 'minimal';
	}
}
