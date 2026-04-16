// src/lib/server/db/dynamodb/license-event-repo.ts
// DynamoDB implementation of ILicenseEventRepo (#804, #1012 stub 解消)
//
// スキーマ:
//   PK = `LICENSE_EVENT#${licenseKey}`
//   SK = `EVENT#${createdAt}#${uuid}`
//   GSI2PK = 'LICENSE_EVENT_ALL' （全イベントを単一パーティションに集約）
//   GSI2SK = `${createdAt}#${uuid}`
//
// アクセスパターン:
// - insert: PutItem
// - findByLicenseKey(key, limit): Query PK=`LICENSE_EVENT#${key}`, SIF=false, Limit=limit
// - findRecent(limit): Query GSI2 PK='LICENSE_EVENT_ALL', SIF=false, Limit=limit
// - countRecentFailuresByIp(windowMin, limit): Query GSI2 PK='LICENSE_EVENT_ALL' +
//   FilterExpression (eventType='validation_failed' + ip exists + GSI2SK>=since) を
//   時間窓内でページング集計。小規模運用想定 (時間窓内イベント数が safetyCap=5000 以下) で許容。

import { randomUUID } from 'node:crypto';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
	InsertLicenseEventInput,
	LicenseEventRow,
	LicenseEventType,
} from '../interfaces/license-event-repo.interface';
import { GSI, getDocClient, TABLE_NAME } from './client';

const LICENSE_EVENT_PK_PREFIX = 'LICENSE_EVENT#';
const ALL_EVENTS_GSI_PK = 'LICENSE_EVENT_ALL';

const doc = () => getDocClient();

let _idCounter = 0;
function nextId(): number {
	_idCounter = (_idCounter + 1) % 100;
	return Date.now() * 100 + _idCounter;
}

function itemToRow(item: Record<string, unknown>): LicenseEventRow {
	return {
		id: (item.id as number) ?? 0,
		eventType: item.eventType as LicenseEventType,
		licenseKey: item.licenseKey as string,
		tenantId: (item.tenantId as string | null) ?? null,
		actorId: (item.actorId as string | null) ?? null,
		ip: (item.ip as string | null) ?? null,
		ua: (item.ua as string | null) ?? null,
		metadata: (item.metadata as string | null) ?? null,
		createdAt: item.createdAt as string,
	};
}

export async function insert(input: InsertLicenseEventInput): Promise<void> {
	const createdAt = new Date().toISOString();
	const sortToken = `${createdAt}#${randomUUID()}`;
	const id = nextId();
	const metadataJson =
		input.metadata === undefined || input.metadata === null ? null : JSON.stringify(input.metadata);

	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				PK: `${LICENSE_EVENT_PK_PREFIX}${input.licenseKey}`,
				SK: `EVENT#${sortToken}`,
				GSI2PK: ALL_EVENTS_GSI_PK,
				GSI2SK: sortToken,
				id,
				eventType: input.eventType,
				licenseKey: input.licenseKey,
				tenantId: input.tenantId ?? null,
				actorId: input.actorId ?? null,
				ip: input.ip ?? null,
				ua: input.ua ?? null,
				metadata: metadataJson,
				createdAt,
			},
		}),
	);
}

export async function findByLicenseKey(
	licenseKey: string,
	limit: number,
): Promise<LicenseEventRow[]> {
	const resp = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk',
			ExpressionAttributeValues: { ':pk': `${LICENSE_EVENT_PK_PREFIX}${licenseKey}` },
			ScanIndexForward: false,
			Limit: limit,
		}),
	);
	return (resp.Items ?? []).map((it) => itemToRow(it as Record<string, unknown>));
}

export async function findRecent(limit: number): Promise<LicenseEventRow[]> {
	const resp = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			IndexName: GSI.GSI2,
			KeyConditionExpression: 'GSI2PK = :pk',
			ExpressionAttributeValues: { ':pk': ALL_EVENTS_GSI_PK },
			ScanIndexForward: false,
			Limit: limit,
		}),
	);
	return (resp.Items ?? []).map((it) => itemToRow(it as Record<string, unknown>));
}

export async function countRecentFailuresByIp(
	windowMinutes: number,
	limit: number,
): Promise<Array<{ ip: string; count: number }>> {
	const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
	const sinceToken = `${since}#`;

	const counts = new Map<string, number>();
	let lastKey: Record<string, unknown> | undefined;
	const safetyCap = 5000;
	let scanned = 0;

	do {
		const resp = await doc().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				IndexName: GSI.GSI2,
				KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK >= :since',
				FilterExpression: 'eventType = :ft AND attribute_exists(ip)',
				ExpressionAttributeValues: {
					':pk': ALL_EVENTS_GSI_PK,
					':since': sinceToken,
					':ft': 'validation_failed',
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of resp.Items ?? []) {
			const ip = (item as Record<string, unknown>).ip as string | null;
			if (!ip) continue;
			counts.set(ip, (counts.get(ip) ?? 0) + 1);
		}
		scanned += resp.ScannedCount ?? 0;
		lastKey = resp.LastEvaluatedKey;
		if (scanned >= safetyCap) break;
	} while (lastKey);

	return [...counts.entries()]
		.map(([ip, count]) => ({ ip, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, limit);
}
