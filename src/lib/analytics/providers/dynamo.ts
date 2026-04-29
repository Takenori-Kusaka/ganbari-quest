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
