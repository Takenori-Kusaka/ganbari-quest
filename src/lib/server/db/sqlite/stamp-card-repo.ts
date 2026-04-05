// src/lib/server/db/sqlite/stamp-card-repo.ts
// SQLite implementation of IStampCardRepo

import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import * as schema from '../schema';
import type {
	InsertStampCardInput,
	InsertStampEntryInput,
	StampCard,
	StampEntryWithMaster,
	StampMaster,
	UpdateStampCardStatusInput,
} from '../types';

/** 有効なスタンプマスタ一覧を取得 */
export async function findEnabledStampMasters(_tenantId: string): Promise<StampMaster[]> {
	return db.select().from(schema.stampMasters).where(eq(schema.stampMasters.isEnabled, 1)).all();
}

/** 子供ID＋週開始日でスタンプカードを検索 */
export async function findCardByChildAndWeek(
	childId: number,
	weekStart: string,
	_tenantId: string,
): Promise<StampCard | undefined> {
	return db
		.select()
		.from(schema.stampCards)
		.where(and(eq(schema.stampCards.childId, childId), eq(schema.stampCards.weekStart, weekStart)))
		.get();
}

/** スタンプカードを新規作成 */
export async function insertCard(
	input: InsertStampCardInput,
	_tenantId: string,
): Promise<StampCard> {
	db.insert(schema.stampCards)
		.values({
			childId: input.childId,
			weekStart: input.weekStart,
			weekEnd: input.weekEnd,
			status: input.status ?? 'collecting',
		})
		.run();

	const card = db
		.select()
		.from(schema.stampCards)
		.where(
			and(
				eq(schema.stampCards.childId, input.childId),
				eq(schema.stampCards.weekStart, input.weekStart),
			),
		)
		.get();

	if (!card) {
		throw new Error('Failed to create stamp card');
	}
	return card;
}

/** カードIDに紐づくエントリ一覧をスタンプマスタ情報付きで取得 */
export async function findEntriesWithMasterByCardId(
	cardId: number,
	_tenantId: string,
): Promise<StampEntryWithMaster[]> {
	return db
		.select({
			slot: schema.stampEntries.slot,
			stampMasterId: schema.stampEntries.stampMasterId,
			omikujiRank: schema.stampEntries.omikujiRank,
			loginDate: schema.stampEntries.loginDate,
			name: schema.stampMasters.name,
			emoji: schema.stampMasters.emoji,
			rarity: schema.stampMasters.rarity,
		})
		.from(schema.stampEntries)
		.leftJoin(schema.stampMasters, eq(schema.stampEntries.stampMasterId, schema.stampMasters.id))
		.where(eq(schema.stampEntries.cardId, cardId))
		.all();
}

/** スタンプエントリを挿入 */
export async function insertEntry(input: InsertStampEntryInput, _tenantId: string): Promise<void> {
	db.insert(schema.stampEntries)
		.values({
			cardId: input.cardId,
			stampMasterId: input.stampMasterId,
			omikujiRank: input.omikujiRank,
			slot: input.slot,
			loginDate: input.loginDate,
		})
		.run();
}

/** カードのステータスを更新 */
export async function updateCardStatus(
	cardId: number,
	input: UpdateStampCardStatusInput,
	_tenantId: string,
): Promise<void> {
	db.update(schema.stampCards)
		.set({
			status: input.status,
			redeemedPoints: input.redeemedPoints,
			redeemedAt: input.redeemedAt,
			updatedAt: input.updatedAt,
		})
		.where(eq(schema.stampCards.id, cardId))
		.run();
}

/** status='collecting' の場合のみ更新し、affected 行数を返す（冪等ガード） */
export async function updateCardStatusIfCollecting(
	cardId: number,
	input: UpdateStampCardStatusInput,
	_tenantId: string,
): Promise<number> {
	const result = db
		.update(schema.stampCards)
		.set({
			status: input.status,
			redeemedPoints: input.redeemedPoints,
			redeemedAt: input.redeemedAt,
			updatedAt: input.updatedAt,
		})
		.where(and(eq(schema.stampCards.id, cardId), eq(schema.stampCards.status, 'collecting')))
		.run();
	return result.changes;
}

/** テナントの全スタンプカード・エントリを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(schema.stampEntries).run();
	db.delete(schema.stampCards).run();
}
