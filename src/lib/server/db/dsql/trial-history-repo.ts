// src/lib/server/db/dsql/trial-history-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// ITrialHistoryRepo (trial_history) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **§P9 tenant 述語**: findActiveTrials (cron 通知対象の cross-tenant scan、schema §11.2 で
//     明示された例外) を除く全メソッドが family_id = tenantId を WHERE に含む。
//   - **UUID surrogate PK**: trial_id は gen_random_uuid() 採番。entity.id = trial_id 文字列
//     (sqlite の autoincrement 数値 id 文字列化と同 shape 契約)。
//   - **findLatestByTenant の「最新」**: sqlite は id DESC (autoincrement = 挿入順)。DSQL は
//     created_at DESC + trial_id DESC tie-break で決定的に解決する (status-repo の
//     recorded_at DESC, hist_id DESC と同 convention)。
//   - **updateConversion は tenant scope で特定** (#2941 項目 1: id は cross-tenant で衝突し得る
//     前提の防御。DSQL uuid は全域一意だが IDOR 形状排除のため両述語を維持、sqlite と同 shape)。

import { sql } from 'drizzle-orm';
import { todayDateJST } from '$lib/domain/date-utils';
import type {
	ITrialHistoryRepo,
	TrialHistoryRow,
} from '../interfaces/trial-history-repo.interface';
import type { SqlExecutor } from './sql-executor';

interface TrialRow {
	trial_id: string;
	family_id: string;
	start_date: string;
	end_date: string;
	tier: string;
	source: string;
	campaign_id: string | null;
	stripe_subscription_id: string | null;
	upgrade_reason: string | null;
	trial_start_source: string | null;
	created_at: string;
}

const TRIAL_COLUMNS = sql.raw(
	`trial_id, family_id, start_date, end_date, tier, source, campaign_id,
	 stripe_subscription_id, upgrade_reason, trial_start_source, created_at`,
);

/** row → TrialHistoryRow entity (family_id → tenantId マップ)。 */
function toTrialHistory(row: TrialRow): TrialHistoryRow {
	return {
		id: row.trial_id,
		tenantId: row.family_id,
		startDate: row.start_date,
		endDate: row.end_date,
		tier: row.tier,
		source: row.source,
		campaignId: row.campaign_id,
		stripeSubscriptionId: row.stripe_subscription_id,
		upgradeReason: row.upgrade_reason,
		trialStartSource: row.trial_start_source,
		createdAt: row.created_at,
	};
}

/** DSQL 用 ITrialHistoryRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlTrialHistoryRepo(db: SqlExecutor): ITrialHistoryRepo {
	return {
		async findLatestByTenant(tenantId) {
			const result = await db.execute(sql`
				SELECT ${TRIAL_COLUMNS} FROM trial_history
				WHERE family_id = ${tenantId}
				ORDER BY created_at DESC, trial_id DESC
				LIMIT 1
			`);
			const row = result.rows[0] as unknown as TrialRow | undefined;
			return row ? toTrialHistory(row) : undefined;
		},

		async findActiveTrials() {
			// endDate が今日以降のトライアル履歴 (cron 通知対象、cross-tenant scan 許容 §11.2)。
			const today = todayDateJST();
			// #4707: 本契約へ移行済み (stripe_subscription_id あり) の行は終了扱いで通知対象外。
			const result = await db.execute(sql`
				SELECT ${TRIAL_COLUMNS} FROM trial_history
				WHERE end_date >= ${today} AND stripe_subscription_id IS NULL
			`);
			return (result.rows as unknown as TrialRow[]).map(toTrialHistory);
		},

		async insert(input) {
			await db.execute(sql`
				INSERT INTO trial_history
					(family_id, start_date, end_date, tier, source, campaign_id, trial_start_source)
				VALUES (${input.tenantId}, ${input.startDate}, ${input.endDate}, ${input.tier},
					${input.source}, ${input.campaignId ?? null}, ${input.trialStartSource ?? null})
			`);
		},

		async updateConversion(input) {
			// #4707: endDate 指定時のみ end_date を詰める (COALESCE で「省略 = 保持」を 1 文に畳む)。
			await db.execute(sql`
				UPDATE trial_history
				SET stripe_subscription_id = ${input.stripeSubscriptionId},
					upgrade_reason = ${input.upgradeReason},
					end_date = COALESCE(${input.endDate ?? null}::text, end_date)
				WHERE family_id = ${input.tenantId} AND trial_id = ${input.id}
			`);
		},

		async deleteByTenantId(tenantId) {
			await db.execute(sql`DELETE FROM trial_history WHERE family_id = ${tenantId}`);
		},
	};
}
