// src/lib/server/db/sqlite/trial-history-repo.ts
// SQLite implementation of ITrialHistoryRepo (#314, #769)

import { desc, eq, gte } from 'drizzle-orm';
import { db } from '../client';
import type {
	InsertTrialHistoryInput,
	TrialHistoryRow,
	UpdateTrialConversionInput,
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

/** endDate が今日以降のトライアル履歴を返す（cron 通知対象の取得用） */
export async function findActiveTrials(): Promise<TrialHistoryRow[]> {
	const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	return db.select().from(trialHistory).where(gte(trialHistory.endDate, today));
}

export async function insert(input: InsertTrialHistoryInput): Promise<void> {
	await db.insert(trialHistory).values({
		tenantId: input.tenantId,
		startDate: input.startDate,
		endDate: input.endDate,
		tier: input.tier,
		source: input.source,
		campaignId: input.campaignId ?? null,
		trialStartSource: input.trialStartSource ?? null,
	});
}

/** トライアル後のコンバージョン情報を記録（Stripe 本契約移行時に呼ぶ） */
export async function updateConversion(input: UpdateTrialConversionInput): Promise<void> {
	await db
		.update(trialHistory)
		.set({
			stripeSubscriptionId: input.stripeSubscriptionId,
			upgradeReason: input.upgradeReason,
		})
		.where(eq(trialHistory.id, input.id));
}

/** テナントの全トライアル履歴を削除 */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	db.delete(trialHistory).where(eq(trialHistory.tenantId, tenantId)).run();
}
