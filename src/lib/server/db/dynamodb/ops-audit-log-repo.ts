// src/lib/server/db/dynamodb/ops-audit-log-repo.ts
// DynamoDB implementation of IOpsAuditLogRepo (#820, #1012 stub 解消)
//
// スキーマ:
//   PK = 'OPS_AUDIT'
//   SK = `${createdAt}#${uuid}`
//   GSI2PK = `OPS_AUDIT_ACTOR#${actorId}`
//   GSI2SK = `${createdAt}#${uuid}`
//
// アクセスパターン:
// - insert: PutItem
// - findRecent(limit): Query PK='OPS_AUDIT', ScanIndexForward=false, Limit=limit
// - findByActor(actorId, limit): Query GSI2 PK=`OPS_AUDIT_ACTOR#${actorId}`, SIF=false, Limit=limit
//
// id フィールド: DynamoDB にネイティブ autoincrement がないため、
// `Date.now() * 100 + counter` を insert 時に生成する（Number.MAX_SAFE_INTEGER 内で
// 同一ミリ秒内の衝突を回避）。UI では Svelte each のキーとしてのみ使用される。
// 同一プロセス内では単調増加、プロセス間衝突は audit log の用途で許容可能。

import { randomUUID } from 'node:crypto';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
	InsertOpsAuditLogInput,
	OpsAuditLogRow,
} from '../interfaces/ops-audit-log-repo.interface';
import { GSI, getDocClient, TABLE_NAME } from './client';

const OPS_AUDIT_PK = 'OPS_AUDIT';
const ACTOR_GSI_PREFIX = 'OPS_AUDIT_ACTOR#';

const doc = () => getDocClient();

let _idCounter = 0;
function nextId(): number {
	_idCounter = (_idCounter + 1) % 100;
	return Date.now() * 100 + _idCounter;
}

function itemToRow(item: Record<string, unknown>): OpsAuditLogRow {
	return {
		id: (item.id as number) ?? 0,
		actorId: item.actorId as string,
		actorEmail: item.actorEmail as string,
		ip: (item.ip as string | null) ?? null,
		ua: (item.ua as string | null) ?? null,
		action: item.action as string,
		target: (item.target as string | null) ?? null,
		metadata: (item.metadata as string | null) ?? null,
		createdAt: item.createdAt as string,
	};
}

export async function insert(input: InsertOpsAuditLogInput): Promise<void> {
	const createdAt = new Date().toISOString();
	const sortToken = `${createdAt}#${randomUUID()}`;
	const id = nextId();
	const metadataJson =
		input.metadata === undefined || input.metadata === null ? null : JSON.stringify(input.metadata);

	await doc().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				PK: OPS_AUDIT_PK,
				SK: sortToken,
				GSI2PK: `${ACTOR_GSI_PREFIX}${input.actorId}`,
				GSI2SK: sortToken,
				id,
				actorId: input.actorId,
				actorEmail: input.actorEmail,
				ip: input.ip ?? null,
				ua: input.ua ?? null,
				action: input.action,
				target: input.target ?? null,
				metadata: metadataJson,
				createdAt,
			},
		}),
	);
}

export async function findRecent(limit: number): Promise<OpsAuditLogRow[]> {
	const resp = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk',
			ExpressionAttributeValues: { ':pk': OPS_AUDIT_PK },
			ScanIndexForward: false,
			Limit: limit,
		}),
	);
	return (resp.Items ?? []).map((it) => itemToRow(it as Record<string, unknown>));
}

export async function findByActor(actorId: string, limit: number): Promise<OpsAuditLogRow[]> {
	const resp = await doc().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			IndexName: GSI.GSI2,
			KeyConditionExpression: 'GSI2PK = :pk',
			ExpressionAttributeValues: { ':pk': `${ACTOR_GSI_PREFIX}${actorId}` },
			ScanIndexForward: false,
			Limit: limit,
		}),
	);
	return (resp.Items ?? []).map((it) => itemToRow(it as Record<string, unknown>));
}
