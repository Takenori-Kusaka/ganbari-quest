// src/lib/server/db/sqlite/trial-history-repo.ts
// SQLite implementation of ITrialHistoryRepo (#314)

import { desc, eq } from 'drizzle-orm';
import { db } from '../client';
import type {
	InsertTrialHistoryInput,
	TrialHistoryRow,
} from '../interfaces/trial-history-repo.interface';
import { trialHistory } from '../schema';

export async function findLatestByTenant(tenantId: string): Promise<TrialHistoryRow | undefined> {
	const rows = await db
		.select()
		.from(trialHistory)
		.where(eq(trialHistory.tenantId, tenantId))
		.orderBy(desc(trialHistory.id))
		.limit(1);
	return rows[0];
}

export async function insert(input: InsertTrialHistoryInput): Promise<void> {
	await db.insert(trialHistory).values({
		tenantId: input.tenantId,
		startDate: input.startDate,
		endDate: input.endDate,
		tier: input.tier,
		source: input.source,
		campaignId: input.campaignId ?? null,
	});
}
