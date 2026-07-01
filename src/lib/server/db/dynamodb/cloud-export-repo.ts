// src/lib/server/db/dynamodb/cloud-export-repo.ts
// DynamoDB implementation of cloud export repository (#2824 Wave 6B / ADR-0055)
//
// 旧 stub (#2263 hotfix: read = 空 / write = no-op) を本実装に置換。
// SQLite 実装 (sqlite/cloud-export-repo.ts) と機能等価。NUC→cloud バックアップ受領。
//
// キー設計 (keys.ts cloudExportKey、GSI 不要):
//   PK = T#<tenant>#CEXPORT, SK = EXPORT#<id>
//   - tenant scope の list / count / id lookup は Query / GetItem で完結
//   - findByPin (no tenant) / deleteExpired (tenant 横断) は低頻度のため Scan + 属性フィルタ
//     (cancellation-reason-repo と同じ Pre-PMF 方針、ADR-0010)。
//   - s3Key は S3 オブジェクト参照 (本体 blob は S3、本 repo は metadata のみ。SQLite 同様)。

import {
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
	CloudExportRecord,
	CloudExportStatus,
	InsertCloudExportInput,
	UpdateCloudExportStatusInput,
} from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { cloudExportKey, cloudExportSKPrefix, cloudExportTenantPK, ENTITY_NAMES } from './keys';
import { stripKeys } from './repo-helpers';

function mapItem(item: Record<string, unknown>): CloudExportRecord {
	return stripKeys(item) as unknown as CloudExportRecord;
}

export async function findByTenant(tenantId: string): Promise<CloudExportRecord[]> {
	const pk = cloudExportTenantPK(tenantId);
	const items: CloudExportRecord[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const res = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': pk,
					':prefix': cloudExportSKPrefix(),
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of res.Items ?? []) {
			items.push(mapItem(item));
		}
		lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	// SQLite は createdAt desc。DynamoDB SK は id 昇順のためアプリ側でソート。
	return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function findByPin(pinCode: string): Promise<CloudExportRecord | undefined> {
	// pinCode は no-tenant の download 経路。低頻度のため属性フィルタ Scan で対応。
	let lastKey: Record<string, unknown> | undefined;
	do {
		const res = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :prefix) AND pinCode = :pin',
				ExpressionAttributeValues: {
					':prefix': cloudExportSKPrefix(),
					':pin': pinCode,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		const found = (res.Items ?? [])[0];
		if (found) return mapItem(found);
		lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return undefined;
}

export async function findById(
	id: number,
	tenantId: string,
): Promise<CloudExportRecord | undefined> {
	const res = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: cloudExportKey(id, tenantId),
		}),
	);
	return res.Item ? mapItem(res.Item) : undefined;
}

export async function insert(input: InsertCloudExportInput): Promise<CloudExportRecord> {
	const id = await nextId(ENTITY_NAMES.cloudExport, input.tenantId);
	const now = new Date().toISOString();

	const record: CloudExportRecord = {
		id,
		tenantId: input.tenantId,
		exportType: input.exportType,
		pinCode: input.pinCode,
		s3Key: input.s3Key,
		fileSizeBytes: input.fileSizeBytes,
		label: input.label ?? null,
		description: input.description ?? null,
		expiresAt: input.expiresAt,
		downloadCount: 0,
		maxDownloads: input.maxDownloads ?? 10,
		createdAt: now,
		status: input.status ?? 'pending',
		failureReason: null,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...cloudExportKey(id, input.tenantId), ...record },
		}),
	);

	return record;
}

/**
 * #3504: 非同期 build 状態遷移 (tenantId 束縛 exact Key)。ready 遷移時は成果物メタ
 * (fileSizeBytes / description) も同 UpdateItem で確定する。`#status` は DynamoDB 予約語のため
 * ExpressionAttributeNames で別名化する。不在 (tenant 不一致含む) は silent no-op。
 */
export async function updateStatus(
	id: number,
	tenantId: string,
	status: CloudExportStatus,
	opts?: UpdateCloudExportStatusInput,
): Promise<void> {
	const names: Record<string, string> = { '#status': 'status', '#fr': 'failureReason' };
	const values: Record<string, unknown> = {
		':status': status,
		// 非 failed 遷移では失敗理由を消す (残渣防止)。opts 指定があればそれを優先。
		':fr': opts?.failureReason ?? null,
	};
	const sets = ['#status = :status', '#fr = :fr'];
	if (opts?.fileSizeBytes !== undefined) {
		names['#fs'] = 'fileSizeBytes';
		values[':fs'] = opts.fileSizeBytes;
		sets.push('#fs = :fs');
	}
	if (opts?.description !== undefined) {
		names['#desc'] = 'description';
		values[':desc'] = opts.description ?? null;
		sets.push('#desc = :desc');
	}
	try {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: cloudExportKey(id, tenantId),
				UpdateExpression: `SET ${sets.join(', ')}`,
				ConditionExpression: 'attribute_exists(PK)',
				ExpressionAttributeNames: names,
				ExpressionAttributeValues: values,
			}),
		);
	} catch (error) {
		if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return;
		throw error;
	}
}

/**
 * #3504: build 待ち (status='pending') を tenant 横断で最大 limit 件返す (cron drain 用)。
 * deleteExpired と同じく低頻度 Scan + 属性フィルタ。`#status` は予約語のため別名化。
 */
export async function findPendingBuilds(limit: number): Promise<CloudExportRecord[]> {
	const items: CloudExportRecord[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const res = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :prefix) AND #status = :pending',
				ExpressionAttributeNames: { '#status': 'status' },
				ExpressionAttributeValues: {
					':prefix': cloudExportSKPrefix(),
					':pending': 'pending',
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of res.Items ?? []) {
			items.push(mapItem(item));
			if (items.length >= limit) return items;
		}
		lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return items;
}

/**
 * #2845 B1: 旧実装は「id のみ受けるため tenant 不明 → 全テーブル Scan で raw key 逆引き」
 * だった (tenant 無束縛 write 形状)。実際は呼び出し元 (cloud-export-service の
 * fetchCloudExportByPin) が findByPin の戻り値 record.tenantId を持つため、signature に
 * tenantId を追加し exact Key (`cloudExportKey`) で直接 UpdateItem する (Scan 撤去)。
 * `attribute_exists(PK)` で phantom item 生成を防ぎ、不在は旧挙動どおり silent no-op。
 */
export async function incrementDownloadCount(id: number, tenantId: string): Promise<void> {
	try {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: cloudExportKey(id, tenantId),
				UpdateExpression: 'ADD downloadCount :one',
				ConditionExpression: 'attribute_exists(PK)',
				ExpressionAttributeValues: { ':one': 1 },
			}),
		);
	} catch (error) {
		// 不在 (tenant 不一致を含む) は affected 0 と等価の no-op に正規化 (§08-DB 原則 1)
		if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return;
		throw error;
	}
}

export async function deleteById(id: number, tenantId: string): Promise<void> {
	await getDocClient().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: cloudExportKey(id, tenantId),
		}),
	);
}

export async function deleteExpired(now: string): Promise<number> {
	// tenant 横断 + expiresAt < now。低頻度 cron のため Scan + 属性フィルタ。
	const keys: Array<{ PK: string; SK: string }> = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const res = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :prefix) AND expiresAt < :now',
				ExpressionAttributeValues: {
					':prefix': cloudExportSKPrefix(),
					':now': now,
				},
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of res.Items ?? []) {
			keys.push({ PK: item.PK as string, SK: item.SK as string });
		}
		lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);

	for (const key of keys) {
		await getDocClient().send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }));
	}
	return keys.length;
}

export async function countByTenant(tenantId: string): Promise<number> {
	const pk = cloudExportTenantPK(tenantId);
	let count = 0;
	let lastKey: Record<string, unknown> | undefined;
	do {
		const res = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': pk,
					':prefix': cloudExportSKPrefix(),
				},
				Select: 'COUNT',
				ExclusiveStartKey: lastKey,
			}),
		);
		count += res.Count ?? 0;
		lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return count;
}
