// src/lib/server/db/dsql/push-subscription-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// IPushSubscriptionRepo (push_subscriptions + notification_logs) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **§P9 tenant 述語**: findByEndpoint / deleteByEndpoint (ブラウザ Push endpoint の無 tenant
//     値単独 lookup、endpoint global UNIQUE が機能要件 — schema §11.2 で明示された例外。sqlite
//     backend も tenantId を無視する同 shape) を除く全メソッドが family_id = tenantId を含む。
//   - **UUID surrogate PK**: subscription_id / log_id は gen_random_uuid() 採番。
//   - **subscriberRole は Repository 境界で正規化** (#1593 / ADR-0023 I6): 送信側 skip の
//     二重防御があるため、不正値も string 経由で PushSubscriberRole に渡す (sqlite と同判断)。
//   - **0/1 契約**: NotificationLog.success は number (0/1)。DSQL 列は boolean のため
//     読み出しで boolean→0/1 変換する (voice-repo と同 convention)。
//   - **countTodayLogs の当日境界**: sqlite は ISO 文字列比較 (= UTC 日境界)。DSQL は
//     sent_at >= today::timestamptz AND < +interval '1 day' (session tz = UTC) で同義。

import { sql } from 'drizzle-orm';
import type { IPushSubscriptionRepo } from '../interfaces/push-subscription-repo.interface';
import type { NotificationLog, PushSubscriberRole, PushSubscriptionRecord } from '../types';
import type { SqlExecutor } from './sql-executor';

interface PushSubscriptionRow {
	subscription_id: string;
	family_id: string;
	endpoint: string;
	keys_p256dh: string;
	keys_auth: string;
	user_agent: string | null;
	subscriber_role: string;
	created_at: string;
}

interface NotificationLogRow {
	log_id: string;
	family_id: string;
	notification_type: string;
	title: string;
	body: string;
	sent_at: string;
	success: boolean;
	error_message: string | null;
}

const SUBSCRIPTION_COLUMNS = sql.raw(
	`subscription_id, family_id, endpoint, keys_p256dh, keys_auth, user_agent,
	 subscriber_role, created_at`,
);

const LOG_COLUMNS = sql.raw(
	`log_id, family_id, notification_type, title, body, sent_at, success, error_message`,
);

/** row → PushSubscriptionRecord entity (subscriber_role は境界正規化、#1593)。 */
function toSubscription(row: PushSubscriptionRow): PushSubscriptionRecord {
	return {
		id: row.subscription_id,
		tenantId: row.family_id,
		endpoint: row.endpoint,
		keysP256dh: row.keys_p256dh,
		keysAuth: row.keys_auth,
		userAgent: row.user_agent,
		subscriberRole: row.subscriber_role as PushSubscriberRole,
		createdAt: row.created_at,
	};
}

/** row → NotificationLog entity (success boolean→0/1)。 */
function toLog(row: NotificationLogRow): NotificationLog {
	return {
		id: row.log_id,
		tenantId: row.family_id,
		notificationType: row.notification_type,
		title: row.title,
		body: row.body,
		sentAt: row.sent_at,
		success: row.success ? 1 : 0,
		errorMessage: row.error_message,
	};
}

/** DSQL 用 IPushSubscriptionRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlPushSubscriptionRepo(db: SqlExecutor): IPushSubscriptionRepo {
	return {
		async findByTenant(tenantId) {
			const result = await db.execute(sql`
				SELECT ${SUBSCRIPTION_COLUMNS} FROM push_subscriptions
				WHERE family_id = ${tenantId}
				ORDER BY created_at, subscription_id
			`);
			return (result.rows as unknown as PushSubscriptionRow[]).map(toSubscription);
		},

		async findByEndpoint(endpoint, _tenantId) {
			// endpoint global UNIQUE の無 tenant 値単独 lookup (§11.2 機能要件、sqlite と同 shape)。
			const result = await db.execute(sql`
				SELECT ${SUBSCRIPTION_COLUMNS} FROM push_subscriptions WHERE endpoint = ${endpoint}
			`);
			const row = result.rows[0] as unknown as PushSubscriptionRow | undefined;
			return row ? toSubscription(row) : undefined;
		},

		async insert(input) {
			const result = await db.execute(sql`
				INSERT INTO push_subscriptions
					(family_id, endpoint, keys_p256dh, keys_auth, user_agent, subscriber_role)
				VALUES (${input.tenantId}, ${input.endpoint}, ${input.keysP256dh}, ${input.keysAuth},
					${input.userAgent ?? null}, ${input.subscriberRole satisfies PushSubscriberRole})
				RETURNING ${SUBSCRIPTION_COLUMNS}
			`);
			const row = result.rows[0] as unknown as PushSubscriptionRow | undefined;
			if (!row) throw new Error('insert: insert returned no row');
			return toSubscription(row);
		},

		async deleteByEndpoint(endpoint, _tenantId) {
			// endpoint global UNIQUE 前提の値単独削除 (sqlite backend と同 shape)。
			await db.execute(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
		},

		// ── Notification logs ──

		async insertLog(input) {
			const result = await db.execute(sql`
				INSERT INTO notification_logs
					(family_id, notification_type, title, body, success, error_message)
				VALUES (${input.tenantId}, ${input.notificationType}, ${input.title}, ${input.body},
					${input.success}, ${input.errorMessage ?? null})
				RETURNING ${LOG_COLUMNS}
			`);
			const row = result.rows[0] as unknown as NotificationLogRow | undefined;
			if (!row) throw new Error('insertLog: insert returned no row');
			return toLog(row);
		},

		async countTodayLogs(tenantId, today) {
			// UTC 日境界 (sqlite の ISO 文字列比較と同義。sent_at defaultNow() = UTC)。
			const result = await db.execute(sql`
				SELECT count(*) AS c FROM notification_logs
				WHERE family_id = ${tenantId}
					AND sent_at >= ${today}::timestamptz
					AND sent_at < ${today}::timestamptz + interval '1 day'
			`);
			return Number((result.rows[0] as { c: unknown }).c);
		},

		async findRecentLogs(tenantId, limit) {
			const result = await db.execute(sql`
				SELECT ${LOG_COLUMNS} FROM notification_logs
				WHERE family_id = ${tenantId}
				ORDER BY sent_at DESC, log_id DESC
				LIMIT ${limit}
			`);
			return (result.rows as unknown as NotificationLogRow[]).map(toLog);
		},
	};
}
