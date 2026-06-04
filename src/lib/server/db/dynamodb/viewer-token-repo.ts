// src/lib/server/db/dynamodb/viewer-token-repo.ts
// DynamoDB implementation of viewer token repository (#2824 Wave 6B / #371)
//
// 旧 stub (#2263 hotfix: read = 空 / write = no-op) を本実装に置換。
// SQLite 実装 (sqlite/viewer-token-repo.ts) と機能等価。閲覧専用リンク token。
//
// キー設計 (keys.ts viewerTokenKey、GSI 不要):
//   PK = VTOKEN#<token>, SK = META  (token 軸 global partition)
//   - findByToken (no tenant、hot path) を GetItem 1 回で解決
//   - findByTenant / revoke(id) / deleteById(id) は admin 管理画面でのみ発火する
//     低頻度操作のため tenantId 属性フィルタ Scan で対応
//     (cancellation-reason-repo と同じ Pre-PMF 方針、ADR-0010)。
//   - id は SQLite auto-increment 互換のため counter.ts で採番し item 属性に保持。

import {
	DeleteCommand,
	GetCommand,
	PutCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { InsertViewerTokenInput, ViewerToken } from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { ENTITY_NAMES, VIEWER_TOKEN_PK_PREFIX, viewerTokenKey } from './keys';
import { stripKeys } from './repo-helpers';

function mapItem(item: Record<string, unknown>): ViewerToken {
	return stripKeys(item) as unknown as ViewerToken;
}

/** tenant に属する全 token を Scan + 属性フィルタで取得 (raw key 付き)。 */
async function scanByTenant(tenantId: string): Promise<Record<string, unknown>[]> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const res = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(PK, :prefix) AND tenantId = :tid',
				ExpressionAttributeValues: {
					':prefix': VIEWER_TOKEN_PK_PREFIX,
					':tid': tenantId,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of res.Items ?? []) {
			items.push(item);
		}
		lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return items;
}

export async function findByTenant(tenantId: string): Promise<ViewerToken[]> {
	const items = await scanByTenant(tenantId);
	// SQLite は createdAt desc。
	return items.map(mapItem).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function findByToken(token: string): Promise<ViewerToken | undefined> {
	const res = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: viewerTokenKey(token),
		}),
	);
	return res.Item ? mapItem(res.Item) : undefined;
}

export async function insert(
	input: InsertViewerTokenInput,
	tenantId: string,
): Promise<ViewerToken> {
	const id = await nextId(ENTITY_NAMES.viewerToken, tenantId);
	const now = new Date().toISOString();

	const record: ViewerToken = {
		id,
		tenantId,
		token: input.token,
		label: input.label ?? null,
		expiresAt: input.expiresAt ?? null,
		createdAt: now,
		revokedAt: null,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: { ...viewerTokenKey(input.token), ...record },
		}),
	);

	return record;
}

export async function revoke(id: number, tenantId: string): Promise<void> {
	// id 指定だが PK は token 軸。tenant scope で raw item を引き当てて revokedAt をセット。
	const items = await scanByTenant(tenantId);
	const target = items.find((it) => it.id === id);
	if (!target) return;
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: target.PK, SK: target.SK },
			UpdateExpression: 'SET revokedAt = :now',
			ExpressionAttributeValues: { ':now': new Date().toISOString() },
		}),
	);
}

export async function deleteById(id: number, tenantId: string): Promise<void> {
	const items = await scanByTenant(tenantId);
	const target = items.find((it) => it.id === id);
	if (!target) return;
	await getDocClient().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: { PK: target.PK, SK: target.SK },
		}),
	);
}
