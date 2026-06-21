// src/lib/server/db/dynamodb/auto-challenge-repo.ts
// 週次自動チャレンジリポジトリ — DynamoDB 本実装 (#2824 Wave 6A / ADR-0055)
//
// IAutoChallengeRepo を SQLite 実装 (sqlite/auto-challenge-repo.ts、挙動 SSOT) と
// 機能等価に DynamoDB single-table で実装する。
//
// 経緯: 本 repo は #2263 hotfix で「read=空 / write=no-op + logger.warn」化された。
//   自動チャレンジは週次 cron が生成し子供 home で進捗表示される機能であり、本番 cognito
//   Lambda (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で生成・進捗が永続しないと毎週リセット
//   されるため体験が成立しない。本実装で根治する。
//
// key 設計 (keys.ts §autoChallengeKey):
//   PK = T#<tenantId>#CHILD#<childId>   (child partition、stamp_cards / activity_logs と同居)
//   SK = AUTOCHAL#<weekStart>           (weekStart は child 内で一意)
//   → findByChildAndWeek は GetItem 1 回で完結 (weekStart 一意 = SQLite
//     uniqueIndex(child_id, week_start) と等価)。findActiveByChild / findByChild は
//     単一 partition Query (begins_with(SK, 'AUTOCHAL#')) で完結し追加 GSI 不要 (ADR-0055 §3.1)。
//   id だけで引く update と tenant 横断の expireOldChallenges は低頻度 (週次 cron) のため
//   tenant Scan + filter で対象 PK/SK を解決する (stamp-card-repo / message-repo と同パターン)。
//   Scan は ExclusiveStartKey で全ページ走査する (DynamoDB Scan の Limit は filter 適用「前」の
//   評価件数上限なので Limit + Filter は対象が scan 順先頭でない限り空振りする。#2842 修正)。
//
// 関連: ADR-0055 / docs/design/08-データベース設計書.md / sqlite/auto-challenge-repo.ts (SSOT)

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { autoChallengeKey, autoChallengePrefix, childPK, ENTITY_NAMES, tenantPK } from './keys';
import { stripKeys } from './repo-helpers';

const PREFIX = autoChallengePrefix();

/** DynamoDB item を AutoChallenge に正規化する (PK/SK 除去 + default の補完)。 */
function toAutoChallenge(item: Record<string, unknown>): AutoChallenge {
	const s = stripKeys(item) as Record<string, unknown>;
	return {
		id: s.id as number,
		childId: s.childId as number,
		tenantId: s.tenantId as string,
		weekStart: s.weekStart as string,
		categoryId: s.categoryId as number,
		targetCount: s.targetCount as number,
		// SQLite schema default: current_count = 0 / status = 'active'
		currentCount: (s.currentCount ?? 0) as number,
		status: (s.status ?? 'active') as string,
		// #3194: 旧 item には mode / consecutiveMissCount が無いため SQLite schema default で補完
		mode: (s.mode ?? 'weakness') as string,
		consecutiveMissCount: (s.consecutiveMissCount ?? 0) as number,
		createdAt: s.createdAt as string,
		updatedAt: s.updatedAt as string,
	};
}

// ============================================================
// findByChildAndWeek — child + weekStart で 1 件取得 (GetItem)
// ============================================================

export async function findByChildAndWeek(
	childId: number,
	weekStart: string,
	tenantId: string,
): Promise<AutoChallenge | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: autoChallengeKey(childId, weekStart, tenantId),
		}),
	);
	if (!result.Item) return undefined;
	return toAutoChallenge(result.Item);
}

// ============================================================
// findActiveByChild — child の active チャレンジを 1 件取得 (最新 weekStart)
// ============================================================

export async function findActiveByChild(
	childId: number,
	tenantId: string,
): Promise<AutoChallenge | undefined> {
	const items = await queryChildChallenges(childId, tenantId);
	// SQLite: WHERE status = 'active' ORDER BY week_start DESC LIMIT 1
	const active = items
		.map(toAutoChallenge)
		.filter((c) => c.status === 'active')
		.sort(compareWeekStartDesc);
	return active[0];
}

// ============================================================
// findByChild — child の全チャレンジを取得 (weekStart 降順)
// ============================================================

export async function findByChild(
	childId: number,
	tenantId: string,
	limit = 10,
): Promise<AutoChallenge[]> {
	const items = await queryChildChallenges(childId, tenantId);
	// SQLite: ORDER BY week_start DESC LIMIT
	const challenges = items.map(toAutoChallenge).sort(compareWeekStartDesc);
	return challenges.slice(0, limit);
}

// ============================================================
// insert — 自動チャレンジ新規作成
// ============================================================

export async function insert(
	input: InsertAutoChallengeInput,
	tenantId: string,
): Promise<AutoChallenge> {
	const id = await nextId(ENTITY_NAMES.autoChallenge, tenantId);
	const now = new Date().toISOString();
	const challenge: AutoChallenge = {
		id,
		childId: input.childId,
		tenantId,
		weekStart: input.weekStart,
		categoryId: input.categoryId,
		targetCount: input.targetCount,
		// SQLite schema default
		currentCount: 0,
		status: 'active',
		mode: input.mode ?? 'weakness',
		consecutiveMissCount: input.consecutiveMissCount ?? 0,
		createdAt: now,
		updatedAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...autoChallengeKey(input.childId, input.weekStart, tenantId),
				...challenge,
			},
		}),
	);

	return challenge;
}

// ============================================================
// update — id で進捗 / status を更新
// ============================================================

export async function update(
	id: number,
	input: UpdateAutoChallengeInput,
	tenantId: string,
): Promise<void> {
	const found = await findChallengeItemById(id, tenantId);
	if (!found) return;

	const sets: string[] = ['updatedAt = :now'];
	const values: Record<string, unknown> = { ':now': new Date().toISOString() };
	if (input.currentCount !== undefined) {
		sets.push('currentCount = :cc');
		values[':cc'] = input.currentCount;
	}
	if (input.status !== undefined) {
		sets.push('#status = :st');
		values[':st'] = input.status;
	}

	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: found.PK, SK: found.SK },
			UpdateExpression: `SET ${sets.join(', ')}`,
			// status は DynamoDB 予約語のため alias で escape。
			ExpressionAttributeNames: input.status !== undefined ? { '#status': 'status' } : undefined,
			ExpressionAttributeValues: values,
		}),
	);
}

// ============================================================
// expireOldChallenges — 期限切れ active チャレンジを expired にする
// ============================================================

export async function expireOldChallenges(beforeDate: string, tenantId: string): Promise<number> {
	// SQLite: UPDATE ... SET status='expired' WHERE status='active' AND week_start < :beforeDate
	const targets = await scanTenantChallenges(
		' AND #status = :active AND weekStart < :before',
		{ ':active': 'active', ':before': beforeDate },
		{ '#status': 'status' },
		tenantId,
	);
	const now = new Date().toISOString();
	for (const key of targets) {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: key,
				UpdateExpression: 'SET #status = :expired, updatedAt = :now',
				ExpressionAttributeNames: { '#status': 'status' },
				ExpressionAttributeValues: { ':expired': 'expired', ':now': now },
			}),
		);
	}
	return targets.length;
}

// ============================================================
// deleteByTenantId — テナントの全自動チャレンジを削除
// ============================================================

export async function deleteByTenantId(tenantId: string): Promise<void> {
	const { deleteItemsByPkPrefix } = await import('./bulk-delete');
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), PREFIX);
}

// ============================================================
// 内部ヘルパ
// ============================================================

/**
 * weekStart 降順 + id 降順 (tiebreaker) で比較する。
 * SQLite `ORDER BY week_start DESC` の決定的な実装等価 (同 weekStart 時は後発 id を先頭に)。
 */
function compareWeekStartDesc(a: AutoChallenge, b: AutoChallenge): number {
	if (a.weekStart !== b.weekStart) return a.weekStart < b.weekStart ? 1 : -1;
	return b.id - a.id;
}

/** 指定 child partition の AUTOCHAL# item を全件 Query する (ページング対応)。 */
async function queryChildChallenges(
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
 * tenant 配下の AUTOCHAL# item を追加 filter 付きで Scan し PK/SK を解決する。
 * expireOldChallenges 用 (tenant 横断 + week_start 範囲)。
 * Scan の Limit は filter 適用前評価のため付けず、ExclusiveStartKey で全ページ走査する (#2842)。
 */
async function scanTenantChallenges(
	extraFilter: string,
	extraValues: Record<string, unknown>,
	extraNames: Record<string, string>,
	tenantId: string,
): Promise<{ PK: string; SK: string }[]> {
	const doc = getDocClient();
	const keys: { PK: string; SK: string }[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: `begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix)${extraFilter}`,
				ExpressionAttributeNames: extraNames,
				ExpressionAttributeValues: {
					':tenantPrefix': tenantPK('CHILD#', tenantId),
					':skPrefix': PREFIX,
					...extraValues,
				},
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			keys.push({ PK: item.PK as string, SK: item.SK as string });
		}
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return keys;
}

/**
 * id だけ受け取る update 用に、tenant 配下を Scan して PK/SK を解決する。
 * SK は AUTOCHAL#<weekStart> で id を含まないため、tenant Scan + id 属性 filter で 1 件特定する。
 * Scan は全ページ走査し一致 item で早期 return する (#2842 paging 正パターン)。
 */
async function findChallengeItemById(
	id: number,
	tenantId: string,
): Promise<{ PK: string; SK: string } | undefined> {
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
				ProjectionExpression: 'PK, SK',
				ExclusiveStartKey: lastKey,
			}),
		);
		const item = (result.Items ?? [])[0];
		if (item) return { PK: item.PK as string, SK: item.SK as string };
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return undefined;
}
