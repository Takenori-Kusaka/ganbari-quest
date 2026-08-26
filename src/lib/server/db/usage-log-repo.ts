import type { ChildId } from '$lib/domain/ids';
// src/lib/server/db/usage-log-repo.ts — Facade (delegates to factory、#4719)
// 以前は sqlite 固定 import で、本番 pg-core (DSQL / PGlite) では表未作成 throw → WARN + 0 分に
// 化けていた (#4680 class)。backend 選択は factory (getRepos().usageLog) に一本化する。

import { getRepos } from './factory';

export async function insertUsageLog(input: {
	tenantId: string;
	childId: ChildId;
	startedAt: string;
}) {
	return getRepos().usageLog.insertUsageLog(input);
}

export async function updateUsageLogEnd(
	id: string,
	endedAt: string,
	durationSec: number,
	tenantId: string,
) {
	return getRepos().usageLog.updateUsageLogEnd(id, endedAt, durationSec, tenantId);
}

export async function closeOpenSessions(childId: ChildId, endedAt: string, tenantId: string) {
	return getRepos().usageLog.closeOpenSessions(childId, endedAt, tenantId);
}

export async function findTodayUsageLogs(tenantId: string, startedAtFromIso: string) {
	return getRepos().usageLog.findTodayUsageLogs(tenantId, startedAtFromIso);
}

export async function findUsageLogsByChildAndDateRange(
	childId: ChildId,
	tenantId: string,
	fromDate: string,
	toDate: string,
) {
	return getRepos().usageLog.findUsageLogsByChildAndDateRange(childId, tenantId, fromDate, toDate);
}

export async function deleteByTenantId(tenantId: string): Promise<void> {
	return getRepos().usageLog.deleteByTenantId(tenantId);
}
