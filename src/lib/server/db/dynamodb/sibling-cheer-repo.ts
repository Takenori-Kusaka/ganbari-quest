// src/lib/server/db/dynamodb/sibling-cheer-repo.ts
// きょうだい間おうえんスタンプ リポジトリ — DynamoDB 本実装 (#2267 / #2824 Wave 5B / ADR-0055)
//
// ISiblingCheerRepo (interfaces/sibling-cheer-repo.interface.ts) を SQLite 実装
// (sqlite/sibling-cheer-repo.ts、挙動 SSOT) と機能等価に DynamoDB single-table で実装する。
//
// 経緯: 本 repo は #2263 hotfix (PR #2280) で「read=空 / write=no-op + logger.warn」化された。
//   きょうだいおうえんは子供同士の応援送受信 (SiblingCheerOverlay) として child 画面で active。
//   本番 cognito Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で送信が永続しないと
//   応援が届かず体験を毀損する。本実装で根治する。
//
// key 設計 (keys.ts §siblingCheerKey):
//   PK = T#<tenantId>#CHILD#<toChildId>   (受信 child partition、activity_logs / parent_message と同居)
//   SK = CHEER#<paddedId>                 (8 桁 0 埋め、辞書順)
//   → 最頻 read の findUnshownCheers(toChildId) を単一 partition Query
//     (begins_with(SK, 'CHEER#') + shownAt null filter) で完結させる (GSI 不要、ADR-0055 §3.1)。
//   → countTodayCheersFrom(fromChildId) は送信時の 1 日上限チェック (≤5/日、低頻度) のため
//     tenant Scan + fromChildId + sentAt filter で集計する (送信側 read は別軸)。
//   → markShown(cheerIds[]) は cheerId のみ受けるため tenant Scan + id filter で PK/SK を
//     解決し BatchWrite せず個別 Update する (overlay 表示直後の低頻度経路、message-repo /
//     stamp-card-repo の id 解決 Scan と同パターン)。
//
// 関連: ADR-0055 / docs/design/08-データベース設計書.md / sqlite/sibling-cheer-repo.ts (SSOT)

import { PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { todayDateJST } from '$lib/domain/date-utils';
import type { InsertSiblingCheerInput, SiblingCheer } from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { ENTITY_NAMES, siblingCheerKey, siblingCheerPrefix, tenantPK } from './keys';
import { stripKeys } from './repo-helpers';

const PREFIX = siblingCheerPrefix();

/** DynamoDB item を SiblingCheer に正規化する (PK/SK 除去 + null 既定の補完)。 */
function toCheer(item: Record<string, unknown>): SiblingCheer {
	const s = stripKeys(item) as Record<string, unknown>;
	return {
		id: s.id as number,
		fromChildId: s.fromChildId as number,
		toChildId: s.toChildId as number,
		stampCode: s.stampCode as string,
		tenantId: s.tenantId as string,
		sentAt: s.sentAt as string,
		shownAt: (s.shownAt ?? null) as string | null,
	};
}

// ============================================================
// insertCheer — おうえんスタンプを送信 (保存)
// ============================================================

export async function insertCheer(
	input: InsertSiblingCheerInput,
	tenantId: string,
): Promise<SiblingCheer> {
	const id = await nextId(ENTITY_NAMES.siblingCheer, tenantId);
	const cheer: SiblingCheer = {
		id,
		fromChildId: input.fromChildId,
		toChildId: input.toChildId,
		stampCode: input.stampCode,
		tenantId,
		sentAt: new Date().toISOString(),
		shownAt: null,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				// 受信 child partition に配置 (toChildId 軸)。
				...siblingCheerKey(input.toChildId, id, tenantId),
				...cheer,
			},
		}),
	);

	return cheer;
}

// ============================================================
// findUnshownCheers — 子供宛の未表示おうえんを取得
// ============================================================

export async function findUnshownCheers(
	toChildId: number,
	tenantId: string,
): Promise<SiblingCheer[]> {
	const items = await queryChildCheers(toChildId, tenantId);
	// SQLite: WHERE to_child_id = ? AND shown_at IS NULL
	return items.map(toCheer).filter((c) => c.shownAt === null);
}

// ============================================================
// markShown — 指定 id のおうえんを表示済みにする
// ============================================================

export async function markShown(cheerIds: number[], tenantId: string): Promise<void> {
	if (cheerIds.length === 0) return;
	const now = new Date().toISOString();
	const idSet = new Set(cheerIds);
	// cheerId のみ受けるため tenant Scan で対象 item の PK/SK を一括解決する。
	const targets = await scanCheerKeysByIds(idSet, tenantId);
	// SQLite: 各 id を UPDATE shown_at。冪等性のため未指定 item は触らない。
	for (const key of targets) {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: { PK: key.PK, SK: key.SK },
				UpdateExpression: 'SET shownAt = :now',
				ExpressionAttributeValues: { ':now': now },
			}),
		);
	}
}

// ============================================================
// countTodayCheersFrom — 送信者の本日送信数を取得 (1 日上限チェック)
// ============================================================

export async function countTodayCheersFrom(fromChildId: number, tenantId: string): Promise<number> {
	const today = todayDateJST();
	// SQLite: WHERE from_child_id = ? AND sent_at >= `${today}T00:00:00`
	// sentAt は両実装とも ISO 文字列保存のため辞書順比較で機能等価。
	const since = `${today}T00:00:00`;
	const doc = getDocClient();
	let total = 0;
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND fromChildId = :from AND sentAt >= :since',
				ExpressionAttributeValues: {
					':tenantPrefix': tenantPK('CHILD#', tenantId),
					':skPrefix': PREFIX,
					':from': fromChildId,
					':since': since,
				},
				ProjectionExpression: 'id',
				ExclusiveStartKey: lastKey,
			}),
		);
		total += (result.Items ?? []).length;
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return total;
}

// ============================================================
// deleteByTenantId — テナントの全おうえんを削除
// ============================================================

export async function deleteByTenantId(tenantId: string): Promise<void> {
	const { deleteItemsByPkPrefix } = await import('./bulk-delete');
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), PREFIX);
}

// ============================================================
// 内部ヘルパ
// ============================================================

/** 受信 child partition (PK=CHILD#<toChildId>) の CHEER# item を全件 Query する (ページング対応)。 */
async function queryChildCheers(
	toChildId: number,
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
					':pk': tenantPK(`CHILD#${toChildId}`, tenantId),
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
 * markShown 用に、cheerId 集合に一致する item の PK/SK を tenant Scan で一括解決する。
 * cheer は受信 child partition (PK=CHILD#<toChildId>) に分散し toChildId が不明なため、
 * tenant 配下を 1 回走査して id ∈ idSet の item をまとめて拾う (id ごとの個別 Scan を避ける)。
 *
 * 重要 (#2842 教訓): DynamoDB Scan の `Limit` は FilterExpression 適用「前」の評価件数上限で
 * あり、filter 通過後の返却件数ではない。よって `Limit` は付けず `ExclusiveStartKey` で全ページを
 * 走査して一致 item を収集する (message-repo / stamp-card-repo の id 解決 Scan と同パターン)。
 */
async function scanCheerKeysByIds(
	idSet: Set<number>,
	tenantId: string,
): Promise<Array<{ PK: string; SK: string }>> {
	const doc = getDocClient();
	const keys: Array<{ PK: string; SK: string }> = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix)',
				ExpressionAttributeValues: {
					':tenantPrefix': tenantPK('CHILD#', tenantId),
					':skPrefix': PREFIX,
				},
				ProjectionExpression: 'PK, SK, id',
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			if (idSet.has(item.id as number)) {
				keys.push({ PK: item.PK as string, SK: item.SK as string });
			}
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return keys;
}
