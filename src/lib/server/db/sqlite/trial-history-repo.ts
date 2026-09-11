// src/lib/server/db/sqlite/trial-history-repo.ts
// SQLite implementation of ITrialHistoryRepo (#314, #769)

import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { todayDateJST } from '$lib/domain/date-utils';
import { db } from '../client';
import type {
	InsertTrialHistoryInput,
	TrialHistoryRow,
	UpdateTrialConversionInput,
} from '../interfaces/trial-history-repo.interface';
import { trialHistory } from '../schema';

const toRow = (r: typeof trialHistory.$inferSelect): TrialHistoryRow => ({
	...r,
	id: String(r.id),
});

export async function findLatestByTenant(tenantId: string): Promise<TrialHistoryRow | undefined> {
	const rows = await db
		.select()
		.from(trialHistory)
		.where(eq(trialHistory.tenantId, tenantId))
		.orderBy(desc(trialHistory.id))
		.limit(1);
	return rows[0] ? toRow(rows[0]) : undefined;
}

/**
 * endDate が今日以降のトライアル履歴を返す（cron 通知対象の取得用）。
 * #4707: 本契約へ移行済み (stripe_subscription_id あり) の行は終了扱いで除外する。
 */
export async function findActiveTrials(): Promise<TrialHistoryRow[]> {
	const today = todayDateJST();
	const rows = await db
		.select()
		.from(trialHistory)
		.where(and(gte(trialHistory.endDate, today), isNull(trialHistory.stripeSubscriptionId)));
	return rows.map(toRow);
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

/**
 * トライアル後のコンバージョン情報を記録（Stripe 本契約移行時に呼ぶ）。
 * #2941 項目 1: DynamoDB 実装 (tenant 別採番) との等価性 + cross-tenant 上書き防御のため、
 * id 単独でなく tenant scope で record を特定する。
 */
export async function updateConversion(input: UpdateTrialConversionInput): Promise<void> {
	await db
		.update(trialHistory)
		.set({
			stripeSubscriptionId: input.stripeSubscriptionId,
			upgradeReason: input.upgradeReason,
			// #4707: endDate 指定時のみ end_date を詰める (undefined = 更新しない)
			...(input.endDate ? { endDate: input.endDate } : {}),
		})
		.where(and(eq(trialHistory.id, Number(input.id)), eq(trialHistory.tenantId, input.tenantId)));
}

/** テナントの全トライアル履歴を削除 */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	db.delete(trialHistory).where(eq(trialHistory.tenantId, tenantId)).run();
}
