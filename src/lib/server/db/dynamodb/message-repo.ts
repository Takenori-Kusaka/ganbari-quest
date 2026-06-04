// src/lib/server/db/dynamodb/message-repo.ts
// おうえんメッセージ (親→子) リポジトリ — DynamoDB 本実装 (#2266 / #2824 Wave 3A / ADR-0055)
//
// IMessageRepo (interfaces/message-repo.interface.ts) を SQLite 実装
// (sqlite/message-repo.ts、挙動 SSOT) と機能等価に DynamoDB single-table で実装する。
//
// 経緯: 本 repo は #2263 hotfix で「read=空 / write=no-op + logger.warn」化された。
//   おうえんメッセージは LP (feature-cheer-message) が訴求する機能であり、本番 cognito
//   Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で送信が永続しないのは ADR-0013
//   LP truth 違反級。本実装で根治する。
//
// key 設計 (keys.ts §parentMessageKey):
//   PK = T#<tenantId>#CHILD#<childId>   (child partition、activity_logs 等と同居)
//   SK = MSG#<paddedId>                 (8 桁 0 埋め、辞書順)
//   → findMessages / findUnshownMessage / countUnshownMessages は単一 partition Query で
//     完結し GSI 不要 (ADR-0055 §3.1)。markMessageShown は messageId のみ受けるため
//     tenant Scan + id filter で 1 件特定する (reward-redemption-repo と同パターン、低頻度)。
//
// 関連: ADR-0055 / docs/design/08-データベース設計書.md / sqlite/message-repo.ts (SSOT)

import { PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { InsertParentMessageInput, ParentMessage } from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { childPK, ENTITY_NAMES, parentMessageKey, parentMessagePrefix, tenantPK } from './keys';
import { stripKeys } from './repo-helpers';

const PREFIX = parentMessagePrefix();

/**
 * DynamoDB item を ParentMessage に正規化する。
 * SQLite の schema default (icon='💌' / shownAt=null / bonusPoints=null /
 * rewardCategory=null) と整合させるため、欠落しうる属性を補完する
 * (旧データ防御。本実装の write は常に全属性を埋める)。
 */
function toMessage(item: Record<string, unknown>): ParentMessage {
	const s = stripKeys(item) as Record<string, unknown>;
	return {
		id: s.id as number,
		childId: s.childId as number,
		messageType: s.messageType as string,
		stampCode: (s.stampCode ?? null) as string | null,
		body: (s.body ?? null) as string | null,
		icon: (s.icon ?? '💌') as string,
		sentAt: s.sentAt as string,
		shownAt: (s.shownAt ?? null) as string | null,
		bonusPoints: (s.bonusPoints ?? null) as number | null,
		rewardCategory: (s.rewardCategory ?? null) as string | null,
	};
}

// ============================================================
// insertMessage — おうえんメッセージを送信 (保存)
// ============================================================

export async function insertMessage(
	input: InsertParentMessageInput,
	tenantId: string,
): Promise<ParentMessage> {
	const id = await nextId(ENTITY_NAMES.parentMessage, tenantId);
	const message: ParentMessage = {
		id,
		childId: input.childId,
		messageType: input.messageType,
		stampCode: input.stampCode ?? null,
		body: input.body ?? null,
		// SQLite schema default 'icon' = '💌' と一致。
		icon: input.icon ?? '💌',
		sentAt: new Date().toISOString(),
		shownAt: null,
		bonusPoints: input.bonusPoints ?? null,
		rewardCategory: input.rewardCategory ?? null,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...parentMessageKey(input.childId, id, tenantId),
				...message,
			},
		}),
	);

	return message;
}

// ============================================================
// findMessages — 子供のメッセージ履歴を取得 (降順)
// ============================================================

export async function findMessages(
	childId: number,
	limit: number,
	tenantId: string,
): Promise<ParentMessage[]> {
	const items = await queryChildMessages(childId, tenantId);
	const messages = items.map(toMessage);
	// SQLite: ORDER BY sent_at DESC LIMIT。同 sentAt は id 降順を tiebreaker にする
	// (新しい id ほど後発のため SQLite の挿入順 desc と整合する)。
	messages.sort(compareSentAtDesc);
	return messages.slice(0, limit);
}

// ============================================================
// findUnshownMessage — 子供の未表示メッセージを 1 件取得 (最新)
// ============================================================

export async function findUnshownMessage(
	childId: number,
	tenantId: string,
): Promise<ParentMessage | undefined> {
	const items = await queryChildMessages(childId, tenantId);
	// SQLite: WHERE shown_at IS NULL ORDER BY sent_at DESC LIMIT 1
	const unshown = items
		.map(toMessage)
		.filter((m) => m.shownAt === null)
		.sort(compareSentAtDesc);
	return unshown[0];
}

// ============================================================
// countUnshownMessages — 未表示メッセージ数を取得
// ============================================================

export async function countUnshownMessages(childId: number, tenantId: string): Promise<number> {
	const items = await queryChildMessages(childId, tenantId);
	return items.map(toMessage).filter((m) => m.shownAt === null).length;
}

// ============================================================
// markMessageShown — メッセージを表示済みにする
// ============================================================

export async function markMessageShown(
	messageId: number,
	tenantId: string,
): Promise<ParentMessage | undefined> {
	const found = await findMessageItemById(messageId, tenantId);
	if (!found) return undefined;
	const result = await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: found.PK, SK: found.SK },
			UpdateExpression: 'SET shownAt = :now',
			ExpressionAttributeValues: { ':now': new Date().toISOString() },
			ReturnValues: 'ALL_NEW',
		}),
	);
	if (!result.Attributes) return undefined;
	return toMessage(result.Attributes);
}

// ============================================================
// deleteByTenantId — テナントの全メッセージを削除
// ============================================================

export async function deleteByTenantId(tenantId: string): Promise<void> {
	const { deleteItemsByPkPrefix } = await import('./bulk-delete');
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), PREFIX);
}

// ============================================================
// 内部ヘルパ
// ============================================================

/**
 * sentAt 降順 + id 降順 (tiebreaker) で比較する。
 * SQLite `ORDER BY sent_at DESC` の決定的な実装等価 (同 sentAt 時は後発 id を先頭に)。
 */
function compareSentAtDesc(a: ParentMessage, b: ParentMessage): number {
	if (a.sentAt !== b.sentAt) return a.sentAt < b.sentAt ? 1 : -1;
	return b.id - a.id;
}

/** 指定 child partition の MSG# item を全件 Query する (ページング対応)。 */
async function queryChildMessages(
	childId: number,
	tenantId: string,
): Promise<Record<string, unknown>[]> {
	const doc = getDocClient();
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': childPK(childId, tenantId),
					':prefix': PREFIX,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) items.push(item);
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return items;
}

/**
 * messageId だけ受け取る markMessageShown 用に、tenant 配下を Scan して PK/SK + item を
 * 解決する。SK は MSG#<id> だが childId が不明なため tenant Scan + id filter で 1 件特定する。
 *
 * #2842: DynamoDB の Scan `Limit` は **FilterExpression 適用前に評価された item 数** を
 *   上限とするため、`Limit: 1` + Filter では「scan 順で先頭に来た 1 件」が filter に一致
 *   しない限り `Items` が空になり markMessageShown が無言で no-op になる致命バグだった。
 *   正しくは `Limit` を付けず (= page ごと最大 1MB を評価)、`ExclusiveStartKey` で
 *   `LastEvaluatedKey` が尽きるまでページングし、一致 item を見つけた時点で早期 return する。
 *   一致が無ければ全ページ走査後に undefined を返す (queryChildMessages と同じページング正パターン)。
 */
async function findMessageItemById(
	id: number,
	tenantId: string,
): Promise<({ PK: string; SK: string } & Record<string, unknown>) | undefined> {
	const doc = getDocClient();
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND id = :id',
				ExpressionAttributeValues: {
					':tenantPrefix': tenantPK('CHILD#', tenantId),
					':skPrefix': PREFIX,
					':id': id,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		const item = (result.Items ?? [])[0];
		if (item) return item as { PK: string; SK: string } & Record<string, unknown>;
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return undefined;
}
