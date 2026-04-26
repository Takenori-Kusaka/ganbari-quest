// src/lib/server/db/usage-log-repo.ts — Facade for usage-log (#1292)
// SQLite のみ実装（Pre-PMF: DynamoDB 対応は不要、ADR-0010）

export {
	closeOpenSessions,
	deleteByTenantId,
	findTodayUsageLogs,
	findUsageLogsByChildAndDateRange,
	insertUsageLog,
	updateUsageLogEnd,
} from './sqlite/usage-log-repo';
