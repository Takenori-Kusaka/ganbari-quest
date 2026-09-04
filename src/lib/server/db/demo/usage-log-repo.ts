// src/lib/server/db/demo/usage-log-repo.ts
// #4719: Demo IUsageLogRepo。ADR-0048 §決定 §2: stateless Stub (write no-op) + 空 read。
// demo Lambda は利用時間を記録しない (module-level mutable state 禁止)。service 層はここが
// 返す空配列 / dummy 行から「0 分」を導出するだけで、backend 分岐を持たない。

import type { ChildId } from '$lib/domain/ids';
import type { UsageLog } from '../interfaces/usage-log-repo.interface';

export async function insertUsageLog(input: {
	tenantId: string;
	childId: ChildId;
	startedAt: string;
}): Promise<UsageLog> {
	// Stub: 永続化しない dummy 行 (client は fire-and-forget で id を参照しない)。
	return {
		id: '0',
		tenantId: input.tenantId,
		childId: input.childId,
		startedAt: input.startedAt,
		endedAt: null,
		durationSec: null,
	};
}

export async function updateUsageLogEnd(
	_id: string,
	_endedAt: string,
	_durationSec: number,
	_tenantId: string,
	_scopeChildId?: ChildId | null,
): Promise<UsageLog | undefined> {
	return undefined;
}

export async function closeOpenSessions(
	_childId: ChildId,
	_endedAt: string,
	_tenantId: string,
): Promise<void> {}

export async function findTodayUsageLogs(
	_tenantId: string,
	_startedAtFromIso: string,
): Promise<UsageLog[]> {
	return [];
}

export async function findUsageLogsByChildAndDateRange(
	_childId: ChildId,
	_tenantId: string,
	_fromDate: string,
	_toDate: string,
): Promise<UsageLog[]> {
	return [];
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {}
