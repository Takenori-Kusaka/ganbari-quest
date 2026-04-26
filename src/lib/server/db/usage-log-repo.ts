// src/lib/server/db/usage-log-repo.ts — Facade for usage-log (#1292)
// SQLite のみ実装（Pre-PMF: DynamoDB 対応は不要、ADR-0010）

import * as sqliteRepo from './sqlite/usage-log-repo';

export async function insertUsageLog(input: {
	tenantId: string;
	childId: number;
	startedAt: string;
}) {
	return sqliteRepo.insertUsageLog(input);
}

export async function updateUsageLogEnd(
	id: number,
	endedAt: string,
	durationSec: number,
	tenantId: string,
) {
	return sqliteRepo.updateUsageLogEnd(id, endedAt, durationSec, tenantId);
}

export async function closeOpenSessions(childId: number, endedAt: string, tenantId: string) {
	return sqliteRepo.closeOpenSessions(childId, endedAt, tenantId);
}

export async function findTodayUsageLogs(tenantId: string, datePrefix: string) {
	return sqliteRepo.findTodayUsageLogs(tenantId, datePrefix);
}

export async function findUsageLogsByChildAndDateRange(
	childId: number,
	tenantId: string,
	fromDate: string,
	toDate: string,
) {
	return sqliteRepo.findUsageLogsByChildAndDateRange(childId, tenantId, fromDate, toDate);
}

export async function deleteByTenantId(tenantId: string): Promise<void> {
	return sqliteRepo.deleteByTenantId(tenantId);
}
