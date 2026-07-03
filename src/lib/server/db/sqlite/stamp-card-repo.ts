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

/** #3329 backup: child の全スタンプカード。 */
export async function findCardsByChild(childId: number, _tenantId: string): Promise<StampCard[]> {
	return db
		.select()
		.from(schema.stampCards)
		.where(eq(schema.stampCards.childId, childId))
		.orderBy(schema.stampCards.weekStart)
		.all();
}

/** #3329 backup: card に紐づく押印 raw 行 (earnedAt まで含む)。 */
export async function findEntriesByCardId(
	cardId: number,
	_tenantId: string,
): Promise<
	Array<{
		stampMasterId: number | null;
		omikujiRank: string | null;
		slot: number;
		loginDate: string;
		earnedAt: string;
	}>
> {
	return db
		.select({
			stampMasterId: schema.stampEntries.stampMasterId,
			omikujiRank: schema.stampEntries.omikujiRank,
			slot: schema.stampEntries.slot,
			loginDate: schema.stampEntries.loginDate,
			earnedAt: schema.stampEntries.earnedAt,
		})
		.from(schema.stampEntries)
		.where(eq(schema.stampEntries.cardId, cardId))
		.orderBy(schema.stampEntries.slot)
		.all();
}

/** #3329 backup restore 用: status / redeemed / 日時を保全して card を復元する。 */
export async function insertCardForRestore(
	input: Omit<StampCard, 'id'>,
	_tenantId: string,
): Promise<StampCard> {
	const card = db
		.insert(schema.stampCards)
		.values({
			childId: input.childId,
			weekStart: input.weekStart,
			weekEnd: input.weekEnd,
			status: input.status,
			redeemedPoints: input.redeemedPoints,
			redeemedAt: input.redeemedAt,
			createdAt: input.createdAt,
			updatedAt: input.updatedAt,
		})
		.returning()
		.get();
	if (!card) throw new Error('insertCardForRestore: insert returned no row');
	return card;
}

/** #3329 backup restore 用: earnedAt を保全して押印を復元する。 */
export async function insertEntryForRestore(
	input: {
		cardId: number;
		stampMasterId: number | null;
		omikujiRank: string | null;
		slot: number;
		loginDate: string;
		earnedAt: string;
	},
	_tenantId: string,
): Promise<void> {
	db.insert(schema.stampEntries)
		.values({
			cardId: input.cardId,
			stampMasterId: input.stampMasterId,
			omikujiRank: input.omikujiRank,
			slot: input.slot,
			loginDate: input.loginDate,
			earnedAt: input.earnedAt,
		})
		.onConflictDoNothing()
		.run();
}

/** スタンプエントリを挿入（同日重複時は無視） */
export async function insertEntry(input: InsertStampEntryInput, _tenantId: string): Promise<void> {
	db.insert(schema.stampEntries)
		.values({
			cardId: input.cardId,
			stampMasterId: input.stampMasterId,
			omikujiRank: input.omikujiRank,
			slot: input.slot,
			loginDate: input.loginDate,
		})
		.onConflictDoNothing()
		.run();
}

/**
 * カードのステータスを更新。
 * #2845 課題①: childId 所有権検証付き (composite key)。不一致なら no-op。
 */
export async function updateCardStatus(
	childId: number,
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
		.where(and(eq(schema.stampCards.id, cardId), eq(schema.stampCards.childId, childId)))
		.run();
}

/**
 * status='collecting' の場合のみ更新し、affected 行数を返す（冪等ガード）。
 * #2845 課題①: childId 所有権検証付き。不一致 / 非 collecting なら 0。
 */
export async function updateCardStatusIfCollecting(
	childId: number,
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
		.where(
			and(
				eq(schema.stampCards.id, cardId),
				eq(schema.stampCards.childId, childId),
				eq(schema.stampCards.status, 'collecting'),
			),
		)
		.run();
	return result.changes;
}

/** テナントの全スタンプカード・エントリを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(schema.stampEntries).run();
	db.delete(schema.stampCards).run();
}
