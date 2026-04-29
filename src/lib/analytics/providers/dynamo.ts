// src/lib/analytics/providers/dynamo.ts
// DynamoDB business event provider for app-specific analytics.
// Enabled only when ANALYTICS_ENABLED=true.
// Uses the existing DynamoDB single-table design.

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '$lib/server/logger';
import type { AnalyticsProvider, EventProperties } from '../types';

/** DynamoDB analytics event record structure */
export interface AnalyticsEvent {
	PK: string;
	SK: string;
	GSI2PK: string;
	GSI2SK: string;
	eventName: string;
	properties: EventProperties;
	tenantId?: string;
	timestamp: string;
	ttl: number;
}

/** TTL: 90 days retention for analytics events */
const ANALYTICS_TTL_DAYS = 90;

/**
 * DynamoDB provider for business event logging.
 *
 * Uses the existing DynamoDB table (single-table design) with a dedicated
 * key prefix (ANALYTICS#) to separate analytics data from application data.
 *
 * Key schema:
 * - PK: ANALYTICS#<date>
 * - SK: <timestamp>#<random>
 * - GSI2PK: ANALYTICS#EVENT#<eventName>
 * - GSI2SK: <date>#<tenantId>
 *
 * TTL: 90 days (DynamoDB auto-expiry)
 *
 * Requires:
 * - ANALYTICS_ENABLED=true environment variable
 * - DynamoDB table configured (same table as app data)
 */
export class DynamoAnalyticsProvider implements AnalyticsProvider {
	readonly name = 'dynamo';
	private enabled = false;
	private tableName = '';
	private currentTenantId: string | undefined;

	init(): boolean {
		const analyticsEnabled = process.env.ANALYTICS_ENABLED;
		if (analyticsEnabled !== 'true') {
			logger.debug('[analytics] DynamoDB: disabled (ANALYTICS_ENABLED != true)');
			return false;
		}

		this.tableName =
			process.env.ANALYTICS_TABLE_NAME ??
			process.env.DYNAMODB_TABLE ??
			process.env.TABLE_NAME ??
			'ganbari-quest';

		this.enabled = true;
		logger.info('[analytics] DynamoDB: enabled', {
			context: { tableName: this.tableName },
		});
		return true;
	}

	trackEvent(name: string, properties?: EventProperties): void {
		if (!this.enabled) return;
		this.writeEvent(name, properties ?? {}).catch(() => {});
	}

	trackPageView(url: string, referrer?: string): void {
		if (!this.enabled) return;
		this.writeEvent('page_view', { url, referrer }).catch(() => {});
	}

	trackError(error: Error, context?: EventProperties): void {
		if (!this.enabled) return;
		this.writeEvent('error', {
			errorMessage: error.message,
			errorName: error.name,
			...context,
		}).catch(() => {});
	}

	identify(tenantId: string, _traits?: EventProperties): void {
		this.currentTenantId = tenantId;
	}

	async flush(): Promise<void> {
		// DynamoDB writes are immediate — no buffering
	}

	/**
	 * Write an analytics event to DynamoDB.
	 */
	private async writeEvent(eventName: string, properties: EventProperties): Promise<void> {
		try {
			const { PutCommand: PutCmd } = await import('@aws-sdk/lib-dynamodb');
			const { getDocClient: getClient, TABLE_NAME } = await import(
				'$lib/server/db/dynamodb/client'
			);

			const now = new Date();
			const dateStr = now.toISOString().slice(0, 10);
			const timestamp = now.toISOString();
			const random = Math.random().toString(36).slice(2, 10);
			const tableName = this.tableName || TABLE_NAME;

			const ttl = Math.floor(now.getTime() / 1000) + ANALYTICS_TTL_DAYS * 24 * 60 * 60;

			const item: AnalyticsEvent = {
				PK: `ANALYTICS#${dateStr}`,
				SK: `${timestamp}#${random}`,
				GSI2PK: `ANALYTICS#EVENT#${eventName}`,
				GSI2SK: `${dateStr}#${this.currentTenantId ?? 'unknown'}`,
				eventName,
				properties,
				tenantId: this.currentTenantId,
				timestamp,
				ttl,
			};

			const client = getClient();
			await client.send(
				new PutCmd({
					TableName: tableName,
					Item: item,
				}),
			);
		} catch (err) {
			// Analytics must never break the app
			logger.debug('[analytics] DynamoDB: write failed', {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}

/**
 * Query helper: 期間内 (since-date 以降) に指定 event を発火させた unique tenant の件数を返す。
 *
 * #1639 (#1591 follow-up): /admin/analytics の activation funnel 集計で使用。
 * GSI2 query (`GSI2PK=ANALYTICS#EVENT#<name>` AND `GSI2SK >= <since-date>`) を実行し、
 * 結果から tenantId を unique 集計する。
 *
 * 失敗時は `{ uniqueTenants: 0, scannedDates: 0 }` を返す（Pre-PMF: 部分縮退許容、
 * analytics は never break the app の原則を維持）。
 *
 * #1693: tenantId 一覧 (集計レコード fallback union 用) が必要な場合は
 * `queryAnalyticsEventTenantList` を使うこと。
 */
export async function queryAnalyticsEventTenants(
	eventName: string,
	sinceDate: string,
): Promise<{ uniqueTenants: number; scannedDates: number }> {
	try {
		const { getDocClient: getClient, TABLE_NAME: TableName } = await import(
			'$lib/server/db/dynamodb/client'
		);
		const tenants = new Set<string>();
		const dates = new Set<string>();

		let exclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const res = await getClient().send(
				new QueryCommand({
					TableName,
					IndexName: 'GSI2',
					KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK >= :sk',
					ExpressionAttributeValues: {
						':pk': `ANALYTICS#EVENT#${eventName}`,
						':sk': sinceDate,
					},
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);
			for (const item of res.Items ?? []) {
				const tenantId = item.tenantId as string | undefined;
				if (tenantId) tenants.add(tenantId);
				const gsi2sk = item.GSI2SK as string | undefined;
				if (gsi2sk) {
					const datePart = gsi2sk.split('#')[0];
					if (datePart) dates.add(datePart);
				}
			}
			exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
		} while (exclusiveStartKey);

		return { uniqueTenants: tenants.size, scannedDates: dates.size };
	} catch (err) {
		logger.warn('[analytics] queryAnalyticsEventTenants failed', {
			context: { eventName, error: err instanceof Error ? err.message : String(err) },
		});
		return { uniqueTenants: 0, scannedDates: 0 };
	}
}

// ─── #1693: Pre-aggregation read / write helpers ─────────────────────────────
// PK=ANALYTICS_AGG#<YYYY-MM-DD>, SK=FUNNEL / CANCELLATION_<period>
//
// 集計は cron (gq-analytics-aggregator-daily) が前日分を 1 日 1 レコードずつ書く。
// /admin/analytics 画面の query 側は期間内日付分のレコードを取得し、無い分のみ
// ライブ計算で fallback する設計。

/**
 * Analytics aggregate kinds (#1693): SK 値 SSOT
 *
 * services/ 層は no-direct-db-access テスト (`tests/unit/arch/no-direct-db-access.test.ts`)
 * により `$lib/server/db/dynamodb/*` を直接 import できないため、constants は providers/
 * 層に置く。services/ → providers/dynamo.ts 経由で参照する。
 */
export const ANALYTICS_AGG_KIND = {
	FUNNEL: 'FUNNEL',
	CANCELLATION_30D: 'CANCELLATION_30D',
	CANCELLATION_90D: 'CANCELLATION_90D',
} as const;

export type AnalyticsAggregateKind = (typeof ANALYTICS_AGG_KIND)[keyof typeof ANALYTICS_AGG_KIND];

/** Analytics aggregate retention: 365 日 */
export const ANALYTICS_AGG_TTL_DAYS = 365;

/**
 * Funnel aggregate snapshot (1 日分)
 *
 * 各 event について、その日 unique tenant 数を保持する。read 側は期間内日付の値を
 * 合算するのではなく union して unique 数として扱うため、tenantId 一覧も保存する。
 *
 * Pre-PMF (~100 テナント, ADR-0010): 1 日あたり高々数百 tenant ID で十分。
 * Post-PMF で件数が増えたら HyperLogLog 等の近似 sketch に切替検討 (follow-up)。
 */
export interface FunnelDailyAggregate {
	date: string;
	tenantsByEvent: Record<string, string[]>;
}

/**
 * Cancellation aggregate snapshot (1 日分)
 */
export interface CancellationDailyAggregate {
	date: string;
	total: number;
	breakdown: Array<{ category: string; count: number }>;
}

export interface AnalyticsAggregateRecord {
	PK: string;
	SK: string;
	date: string;
	kind: string;
	payload: FunnelDailyAggregate | CancellationDailyAggregate;
	writtenAt: string;
	ttl: number;
}

/**
 * 期間内日付ごとの aggregate レコードを取得する (#1693)。
 *
 * date 範囲スキャン (`PK BEGINS_WITH ANALYTICS_AGG#` AND `PK BETWEEN since AND until`) を
 * 行い、`SK=kind` でフィルタする。Pre-PMF 規模 (~365 件 max) のため Scan で十分。
 *
 * 失敗時は空配列を返す（ライブ計算 fallback に委ねる）。
 */
export async function queryAnalyticsAggregates(
	kind: string,
	sinceDate: string,
	untilDate: string,
): Promise<Array<FunnelDailyAggregate | CancellationDailyAggregate>> {
	try {
		const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
		const { getDocClient: getClient, TABLE_NAME: TableName } = await import(
			'$lib/server/db/dynamodb/client'
		);

		const sincePK = `ANALYTICS_AGG#${sinceDate}`;
		const untilPK = `ANALYTICS_AGG#${untilDate}`;

		const results: Array<FunnelDailyAggregate | CancellationDailyAggregate> = [];
		let exclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const res = await getClient().send(
				new ScanCommand({
					TableName,
					FilterExpression: 'PK BETWEEN :since AND :until AND SK = :sk',
					ExpressionAttributeValues: {
						':since': sincePK,
						':until': untilPK,
						':sk': kind,
					},
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);
			for (const item of res.Items ?? []) {
				const record = item as unknown as AnalyticsAggregateRecord;
				if (record.payload) results.push(record.payload);
			}
			exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
		} while (exclusiveStartKey);

		return results;
	} catch (err) {
		logger.warn('[analytics] queryAnalyticsAggregates failed', {
			context: {
				kind,
				sinceDate,
				untilDate,
				error: err instanceof Error ? err.message : String(err),
			},
		});
		return [];
	}
}

/**
 * `queryAnalyticsEventTenants` の派生 (#1693): unique 件数ではなく **tenantId 一覧**
 * を返す。集計レコード fallback 時の union 計算で使用。
 *
 * Pre-PMF (~100 tenant) では tenantId 一覧の保持は数 KB で問題ない。
 * Post-PMF で件数が増えたら HyperLogLog 等の近似 sketch に切替検討 (follow-up)。
 */
export async function queryAnalyticsEventTenantList(
	eventName: string,
	sinceDate: string,
): Promise<{ tenants: string[]; scannedDates: number }> {
	try {
		const { getDocClient: getClient, TABLE_NAME: TableName } = await import(
			'$lib/server/db/dynamodb/client'
		);
		const tenants = new Set<string>();
		const dates = new Set<string>();
		let exclusiveStartKey: Record<string, unknown> | undefined;
		do {
			const res = await getClient().send(
				new QueryCommand({
					TableName,
					IndexName: 'GSI2',
					KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK >= :sk',
					ExpressionAttributeValues: {
						':pk': `ANALYTICS#EVENT#${eventName}`,
						':sk': sinceDate,
					},
					ExclusiveStartKey: exclusiveStartKey,
				}),
			);
			for (const item of res.Items ?? []) {
				const tenantId = item.tenantId as string | undefined;
				if (tenantId) tenants.add(tenantId);
				const gsi2sk = item.GSI2SK as string | undefined;
				const datePart = gsi2sk?.split('#')[0];
				if (datePart) dates.add(datePart);
			}
			exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
		} while (exclusiveStartKey);
		return { tenants: Array.from(tenants), scannedDates: dates.size };
	} catch (err) {
		logger.warn('[analytics] queryAnalyticsEventTenantList failed', {
			context: { eventName, error: err instanceof Error ? err.message : String(err) },
		});
		return { tenants: [], scannedDates: 0 };
	}
}

/**
 * Aggregate レコードを 1 件 PutItem する (#1693)。
 *
 * TTL 365 日。冪等 (同じ date+kind なら上書き)。
 * 書込み失敗は warn ログを出して swallow (cron 全体は continue)。
 */
export async function putAnalyticsAggregate(
	date: string,
	kind: string,
	payload: FunnelDailyAggregate | CancellationDailyAggregate,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
		const { getDocClient: getClient, TABLE_NAME: TableName } = await import(
			'$lib/server/db/dynamodb/client'
		);
		const writtenAt = new Date().toISOString();
		const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

		const item: AnalyticsAggregateRecord = {
			PK: `ANALYTICS_AGG#${date}`,
			SK: kind,
			date,
			kind,
			payload,
			writtenAt,
			ttl,
		};

		await getClient().send(new PutCommand({ TableName, Item: item }));
		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.warn('[analytics] putAnalyticsAggregate failed', {
			context: { date, kind, error: message },
		});
		return { ok: false, error: message };
	}
}
