// src/lib/server/db/dsql/push-subscription-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// IPushSubscriptionRepo (push_subscriptions + notification_logs) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を含む。**#3574 ② で findByEndpoint /
//     deleteByEndpoint も family scope 再適用に変更**: endpoint (global UNIQUE) は attacker 可制御値
//     のため、値単独 lookup 後に family_id で再スコープし cross-family read / IDOR-delete を遮断する
//     (旧「無 tenant lookup」から改訂。DynamoDB backend は PK=T#<tenant>#PUSH_SUB で元から tenant 束縛)。
//   - **UUID surrogate PK**: subscription_id / log_id は gen_random_uuid() 採番。
//   - **subscriberRole は Repository 境界で正規化** (#1593 / ADR-0023 I6): 送信側 skip の
//     二重防御があるため、不正値も string 経由で PushSubscriberRole に渡す (sqlite と同判断)。
//   - **0/1 契約**: NotificationLog.success は number (0/1)。DSQL 列は boolean のため
//     読み出しで boolean→0/1 変換する (voice-repo と同 convention)。
//   - **countTodayLogs の当日境界**: sqlite は ISO 文字列比較 (= UTC 日境界)。DSQL は
//     UTC anchor 明示の `<today>T00:00:00Z`::timestamptz 範囲で同義 (裸の date cast は
//     session TZ 依存のため禁止 — PGlite はローカル TZ を継承する)。

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

		async findByEndpoint(endpoint, tenantId) {
			// #3574 ②: endpoint (global UNIQUE) の値単独 lookup 後、返却前に family scope を再適用する
			// (§P9)。呼び出し元 (subscribe route) は body.endpoint = attacker 可制御値 + 認証済 tenantId を
			// 渡すため、tenantId 無視 lookup は cross-family read (push key 存在オラクル) 経路になる。
			// endpoint は 1 family にしか属さない (global UNIQUE) ので family 一致時のみ 1 行に解決する。
			const result = await db.execute(sql`
				SELECT ${SUBSCRIPTION_COLUMNS} FROM push_subscriptions
				WHERE endpoint = ${endpoint} AND family_id = ${tenantId}
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

		async deleteByEndpoint(endpoint, tenantId) {
			// #3574 ②: family scope を再適用する (§P9)。unsubscribe route は body.endpoint (attacker
			// 可制御) をそのまま渡すため、family 不一致の削除は cross-family IDOR-delete (他家の購読を
			// 消す) になる。family 一致行のみ削除し不一致は no-op にする。正規呼び出し元 (自 family の
			// findByTenant 由来 endpoint / 送信失敗 cleanup) は tenantId が endpoint 所有者と一致する。
			await db.execute(sql`
				DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND family_id = ${tenantId}
			`);
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

		async countLogsBetween(tenantId, fromIso, toIso) {
			// #4722: 境界は呼び出し側が instant (UTC ISO) にして渡す。'YYYY-MM-DD'::timestamptz の裸 cast は
			// **session TZ 依存** (実 DSQL は TZ=UTC 固定 P10 だが PGlite はローカル TZ を継承する) で、
			// かつ JST 暦日をそのまま UTC 日境界として使うとカウント窓が 9 時間ずれる。
			const result = await db.execute(sql`
				SELECT count(*) AS c FROM notification_logs
				WHERE family_id = ${tenantId}
					AND sent_at >= ${fromIso}::timestamptz
					AND sent_at < ${toIso}::timestamptz
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
