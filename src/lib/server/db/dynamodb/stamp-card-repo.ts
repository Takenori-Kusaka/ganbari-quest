// src/lib/server/db/dynamodb/stamp-card-repo.ts
// スタンプカードリポジトリ — DynamoDB 本実装 (#2824 Wave 3B / ADR-0055)
//
// IStampCardRepo (interfaces/stamp-card-repo.interface.ts) を SQLite 実装
// (sqlite/stamp-card-repo.ts、挙動 SSOT) と機能等価に DynamoDB single-table で実装する。
//
// 経緯: 本 repo は #2263 hotfix (PR #2280) で「read=空 / write=no-op + logger.warn」化された。
//   スタンプカードは子供のコアゲーミフィケーションループ (おみくじシール / 週末 redeem) であり、
//   子供 home の自動押印 (`?/loginStamp` action) は本番 cognito Lambda
//   (AUTH_MODE=cognito + DATA_SOURCE=dynamodb) で active。書込みが永続しないと週跨ぎで
//   スタンプ履歴が消失し体験の核を毀損する。本実装で根治する。
//
// key 設計 (keys.ts §stampCardKey / §stampEntryKey):
//   stamp_cards : PK = T#<tid>#CHILD#<childId>   SK = STMPCARD#<weekStart>
//     → child partition 同居 (special_rewards / activity_logs と同じ)。
//       findCardByChildAndWeek は childId + weekStart 既知の GetItem 1 回で完結。
//       weekStart 一意 = SQLite uniqueIndex(child_id, week_start) と等価。
//   stamp_entries: PK = T#<tid>#STMPCARD#<cardId> SK = STMPENT#<paddedSlot>
//     → entry は cardId だけで lookup される (findEntriesWithMasterByCardId に childId が
//       渡らない) ため card 自身を partition key にした専用 partition に置く。
//       単一 partition Query で全 entry を取得でき追加 GSI 不要 (ADR-0055 §3.1)。
//   cardId だけで引く updateCardStatus* は低頻度 (週次 redeem) のため tenant Scan + id filter
//   で PK/SK を解決する (reward-redemption-repo.updateRedemptionRequestStatus と同パターン)。
//
// stamp master JOIN:
//   SQLite の findEntriesWithMasterByCardId は stamp_entries LEFT JOIN stamp_masters で
//   name / emoji / rarity を返す。DynamoDB では固定 16 件 SSOT (getDefaultStampMasters) を
//   in-memory map で解決する (stamp master は tenant 別カスタマイズなし Pre-PMF、
//   findEnabledStampMasters も同 SSOT を返すため整合)。
//
// 関連: ADR-0055 / docs/design/08-データベース設計書.md / sqlite/stamp-card-repo.ts (SSOT)

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getDefaultStampMasters } from '../stamp-master-defaults';
import type {
	InsertStampCardInput,
	InsertStampEntryInput,
	StampCard,
	StampEntryWithMaster,
	StampMaster,
	UpdateStampCardStatusInput,
} from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	ENTITY_NAMES,
	stampCardKey,
	stampCardPrefix,
	stampEntryCardPK,
	stampEntryKey,
	stampEntryPrefix,
	tenantPK,
} from './keys';
import { stripKeys } from './repo-helpers';

const CARD_PREFIX = stampCardPrefix();
const ENTRY_PREFIX = stampEntryPrefix();

/** DynamoDB item を StampCard に正規化する (PK/SK 除去 + null 既定の補完)。 */
function toCard(item: Record<string, unknown>): StampCard {
	const stripped = stripKeys(item) as Record<string, unknown>;
	return {
		id: stripped.id as number,
		childId: stripped.childId as number,
		weekStart: stripped.weekStart as string,
		weekEnd: stripped.weekEnd as string,
		status: stripped.status as string,
		redeemedPoints: (stripped.redeemedPoints ?? null) as number | null,
		redeemedAt: (stripped.redeemedAt ?? null) as string | null,
		createdAt: stripped.createdAt as string,
		updatedAt: stripped.updatedAt as string,
	};
}

// ============================================================
// findEnabledStampMasters — 有効な stamp master 一覧
// ============================================================

/**
 * 有効な stamp master 16 件を返す。tenant 別カスタマイズ機構は未実装 (Pre-PMF) のため
 * DEFAULT_STAMP_MASTERS_DATA SSOT を全 tenant 共通で返す。空配列を返すと
 * stamp-card-service.stampToday が NO_STAMPS_AVAILABLE になるため必ず 16 件を返す。
 */
export async function findEnabledStampMasters(_tenantId: string): Promise<StampMaster[]> {
	return getDefaultStampMasters();
}

// ============================================================
// findCardByChildAndWeek — child + weekStart で 1 件取得 (GetItem)
// ============================================================

export async function findCardByChildAndWeek(
	childId: number,
	weekStart: string,
	tenantId: string,
): Promise<StampCard | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: stampCardKey(childId, weekStart, tenantId),
		}),
	);
	if (!result.Item) return undefined;
	return toCard(result.Item);
}

// ============================================================
// insertCard — スタンプカード新規作成
// ============================================================

export async function insertCard(
	input: InsertStampCardInput,
	tenantId: string,
): Promise<StampCard> {
	const id = await nextId(ENTITY_NAMES.stampCard, tenantId);
	const now = new Date().toISOString();
	const card: StampCard = {
		id,
		childId: input.childId,
		weekStart: input.weekStart,
		weekEnd: input.weekEnd,
		// SQLite schema default 'collecting' と一致。
		status: input.status ?? 'collecting',
		redeemedPoints: null,
		redeemedAt: null,
		createdAt: now,
		updatedAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...stampCardKey(input.childId, input.weekStart, tenantId),
				...card,
			},
		}),
	);

	return card;
}

// ============================================================
// findEntriesWithMasterByCardId — card の entry 一覧 (master JOIN 付き)
// ============================================================

export async function findEntriesWithMasterByCardId(
	cardId: number,
	tenantId: string,
): Promise<StampEntryWithMaster[]> {
	const items = await queryCardEntries(cardId, tenantId);

	// stamp master を id → master の map で in-memory 解決 (SQLite の LEFT JOIN 相当)。
	const masterById = new Map<number, StampMaster>();
	for (const m of getDefaultStampMasters()) masterById.set(m.id, m);

	const entries: StampEntryWithMaster[] = items.map((item) => {
		const stripped = stripKeys(item) as Record<string, unknown>;
		const stampMasterId = (stripped.stampMasterId ?? null) as number | null;
		const master = stampMasterId != null ? masterById.get(stampMasterId) : undefined;
		return {
			slot: stripped.slot as number,
			stampMasterId,
			omikujiRank: (stripped.omikujiRank ?? null) as string | null,
			loginDate: stripped.loginDate as string,
			// LEFT JOIN: master 不在なら null (SQLite と一致)。
			name: master?.name ?? null,
			emoji: master?.emoji ?? null,
			rarity: master?.rarity ?? null,
		};
	});

	// SQLite は INSERT 順 (rowid)。slot 昇順で揃える (slot は押印順 = 挿入順)。
	entries.sort((a, b) => a.slot - b.slot);
	return entries;
}

// ============================================================
// insertEntry — スタンプ押印 (同 slot 重複は無視)
// ============================================================

export async function insertEntry(input: InsertStampEntryInput, tenantId: string): Promise<void> {
	try {
		await getDocClient().send(
			new PutCommand({
				TableName: TABLE_NAME,
				Item: {
					...stampEntryKey(input.cardId, input.slot, tenantId),
					cardId: input.cardId,
					stampMasterId: input.stampMasterId,
					omikujiRank: input.omikujiRank,
					slot: input.slot,
					loginDate: input.loginDate,
					earnedAt: new Date().toISOString(),
				},
				// SQLite onConflictDoNothing 等価: 同 (cardId, slot) が既存なら上書きしない。
				ConditionExpression: 'attribute_not_exists(PK)',
			}),
		);
	} catch (e) {
		// 既存 (slot 重複) は no-op で握りつぶす (onConflictDoNothing と一致)。
		if (e instanceof Error && e.name === 'ConditionalCheckFailedException') return;
		throw e;
	}
}

// ============================================================
// updateCardStatus — card status を更新 (cardId → Scan で PK/SK 解決)
// ============================================================

export async function updateCardStatus(
	cardId: number,
	input: UpdateStampCardStatusInput,
	tenantId: string,
): Promise<void> {
	const found = await findCardItemById(cardId, tenantId);
	if (!found) return;
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: found.PK, SK: found.SK },
			UpdateExpression:
				'SET #status = :status, redeemedPoints = :rp, redeemedAt = :ra, updatedAt = :ua',
			ExpressionAttributeNames: { '#status': 'status' },
			ExpressionAttributeValues: {
				':status': input.status,
				':rp': input.redeemedPoints,
				':ra': input.redeemedAt,
				':ua': input.updatedAt,
			},
		}),
	);
}

// ============================================================
// updateCardStatusIfCollecting — collecting のみ更新し affected 数を返す (冪等ガード)
// ============================================================

export async function updateCardStatusIfCollecting(
	cardId: number,
	input: UpdateStampCardStatusInput,
	tenantId: string,
): Promise<number> {
	const found = await findCardItemById(cardId, tenantId);
	if (!found) return 0;
	try {
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: { PK: found.PK, SK: found.SK },
				UpdateExpression:
					'SET #status = :status, redeemedPoints = :rp, redeemedAt = :ra, updatedAt = :ua',
				ExpressionAttributeNames: { '#status': 'status' },
				ExpressionAttributeValues: {
					':status': input.status,
					':rp': input.redeemedPoints,
					':ra': input.redeemedAt,
					':ua': input.updatedAt,
					':collecting': 'collecting',
				},
				// SQLite WHERE status='collecting' 等価: 同時 redeem の二重付与を防ぐ。
				ConditionExpression: '#status = :collecting',
			}),
		);
		return 1;
	} catch (e) {
		// 既に redeemed 等で collecting でないなら affected=0 (SQLite result.changes と一致)。
		if (e instanceof Error && e.name === 'ConditionalCheckFailedException') return 0;
		throw e;
	}
}

// ============================================================
// deleteByTenantId — テナントの全カード・エントリを削除
// ============================================================

export async function deleteByTenantId(tenantId: string): Promise<void> {
	const { deleteItemsByPkPrefix } = await import('./bulk-delete');
	// cards: child partition 配下の STMPCARD# item。
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), CARD_PREFIX);
	// entries: 専用 STMPCARD#<cardId> partition 配下の STMPENT# item。
	await deleteItemsByPkPrefix(tenantPK('STMPCARD#', tenantId), ENTRY_PREFIX);
}

// ============================================================
// 内部ヘルパ
// ============================================================

/** card partition (PK=STMPCARD#<cardId>) の STMPENT# item を全件 Query する (ページング対応)。 */
async function queryCardEntries(
	cardId: number,
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
					':pk': stampEntryCardPK(cardId, tenantId),
					':prefix': ENTRY_PREFIX,
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
 * cardId だけ受け取る update* 用に、tenant 配下を Scan して card item (PK/SK) を解決する。
 * card は child partition (PK=CHILD#<cId>, SK=STMPCARD#<weekStart>) に分散し childId が
 * 不明なため、tenant Scan + id filter で 1 件特定する (reward-redemption-repo と同パターン)。
 * redeem は週次・低頻度のため Pre-PMF では GSI 不要 (ADR-0010)。
 */
async function findCardItemById(
	cardId: number,
	tenantId: string,
): Promise<{ PK: string; SK: string } | undefined> {
	const result = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression:
				'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND id = :id',
			ExpressionAttributeValues: {
				':tenantPrefix': tenantPK('CHILD#', tenantId),
				':skPrefix': CARD_PREFIX,
				':id': cardId,
			},
			ProjectionExpression: 'PK, SK',
			Limit: 1,
		}),
	);
	const item = (result.Items ?? [])[0];
	if (!item) return undefined;
	return { PK: item.PK as string, SK: item.SK as string };
}
