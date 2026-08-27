// src/lib/server/db/sqlite/stamp-card-repo.ts
// SQLite implementation of IStampCardRepo

import { and, eq, lt } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
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

type CardRow = typeof schema.stampCards.$inferSelect;
type MasterRow = typeof schema.stampMasters.$inferSelect;

const toCard = (r: CardRow): StampCard => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
});

const toMaster = (r: MasterRow): StampMaster => ({ ...r, id: String(r.id) });

/** 有効なスタンプマスタ一覧を取得 */
export async function findEnabledStampMasters(_tenantId: string): Promise<StampMaster[]> {
	return db
		.select()
		.from(schema.stampMasters)
		.where(eq(schema.stampMasters.isEnabled, 1))
		.all()
		.map(toMaster);
}

/** 子供ID＋週開始日でスタンプカードを検索 */
export async function findCardByChildAndWeek(
	childId: ChildId,
	weekStart: string,
	_tenantId: string,
): Promise<StampCard | undefined> {
	const row = db
		.select()
		.from(schema.stampCards)
		.where(
			and(
				eq(schema.stampCards.childId, Number(childId)),
				eq(schema.stampCards.weekStart, weekStart),
			),
		)
		.get();
	return row ? toCard(row) : undefined;
}

/** スタンプカードを新規作成 */
export async function insertCard(
	input: InsertStampCardInput,
	_tenantId: string,
): Promise<StampCard> {
	db.insert(schema.stampCards)
		.values({
			childId: Number(input.childId),
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
				eq(schema.stampCards.childId, Number(input.childId)),
				eq(schema.stampCards.weekStart, input.weekStart),
			),
		)
		.get();

	if (!card) {
		throw new Error('Failed to create stamp card');
	}
	return toCard(card);
}

/** カードIDに紐づくエントリ一覧をスタンプマスタ情報付きで取得 */
export async function findEntriesWithMasterByCardId(
	cardId: string,
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
		.where(eq(schema.stampEntries.cardId, Number(cardId)))
		.all()
		.map((r) => ({
			...r,
			stampMasterId: r.stampMasterId === null ? null : String(r.stampMasterId),
		}));
}

/** #3329 backup: child の全スタンプカード。 */
export async function findCardsByChild(childId: ChildId, _tenantId: string): Promise<StampCard[]> {
	return db
		.select()
		.from(schema.stampCards)
		.where(eq(schema.stampCards.childId, Number(childId)))
		.orderBy(schema.stampCards.weekStart)
		.all()
		.map(toCard);
}

/** #4687: 今週より前の未交換 (collecting) カードを古い順で返す。 */
export async function findUnredeemedCardsBefore(
	childId: ChildId,
	weekStart: string,
	_tenantId: string,
): Promise<StampCard[]> {
	return db
		.select()
		.from(schema.stampCards)
		.where(
			and(
				eq(schema.stampCards.childId, Number(childId)),
				lt(schema.stampCards.weekStart, weekStart),
				eq(schema.stampCards.status, 'collecting'),
			),
		)
		.orderBy(schema.stampCards.weekStart)
		.all()
		.map(toCard);
}

/** #3329 backup: card に紐づく押印 raw 行 (earnedAt まで含む)。 */
export async function findEntriesByCardId(
	cardId: string,
	_tenantId: string,
): Promise<
	Array<{
		stampMasterId: string | null;
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
		.where(eq(schema.stampEntries.cardId, Number(cardId)))
		.orderBy(schema.stampEntries.slot)
		.all()
		.map((r) => ({
			...r,
			stampMasterId: r.stampMasterId === null ? null : String(r.stampMasterId),
		}));
}

/**
 * #3329 backup restore 用: status / redeemed / 日時を保全して card を復元する。
 * #3394 統一冪等契約: 同 (childId, weekStart) 既存 (idx_stamp_cards_child_week 衝突) は
 * onConflictDoNothing で skip し null を返す (DynamoDB attribute_not_exists と機能等価)。
 */
export async function insertCardForRestore(
	input: Omit<StampCard, 'id'>,
	_tenantId: string,
): Promise<StampCard | null> {
	const card = db
		.insert(schema.stampCards)
		.values({
			childId: Number(input.childId),
			weekStart: input.weekStart,
			weekEnd: input.weekEnd,
			status: input.status,
			redeemedPoints: input.redeemedPoints,
			redeemedAt: input.redeemedAt,
			createdAt: input.createdAt,
			updatedAt: input.updatedAt,
		})
		.onConflictDoNothing()
		.returning()
		.get();
	return card ? toCard(card) : null;
}

/**
 * #3329 backup restore 用: earnedAt を保全して押印を復元する。
 * #3394 統一冪等契約: 実 insert したら true / 重複 ((cardId,slot) or (cardId,loginDate)) skip は
 * false を返す (import は true のときのみ imported++ = count 偽装防止)。
 */
export async function insertEntryForRestore(
	input: {
		cardId: string;
		stampMasterId: string | null;
		omikujiRank: string | null;
		slot: number;
		loginDate: string;
		earnedAt: string;
	},
	_tenantId: string,
): Promise<boolean> {
	const result = db
		.insert(schema.stampEntries)
		.values({
			cardId: Number(input.cardId),
			stampMasterId: input.stampMasterId === null ? null : Number(input.stampMasterId),
			omikujiRank: input.omikujiRank,
			slot: input.slot,
			loginDate: input.loginDate,
			earnedAt: input.earnedAt,
		})
		.onConflictDoNothing()
		.run();
	return result.changes > 0;
}

/** スタンプエントリを挿入（同日重複時は無視） */
export async function insertEntry(input: InsertStampEntryInput, _tenantId: string): Promise<void> {
	db.insert(schema.stampEntries)
		.values({
			cardId: Number(input.cardId),
			stampMasterId: Number(input.stampMasterId),
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
	childId: ChildId,
	cardId: string,
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
		.where(
			and(eq(schema.stampCards.id, Number(cardId)), eq(schema.stampCards.childId, Number(childId))),
		)
		.run();
}

/**
 * status='collecting' の場合のみ更新し、affected 行数を返す（冪等ガード）。
 * #2845 課題①: childId 所有権検証付き。不一致 / 非 collecting なら 0。
 */
export async function updateCardStatusIfCollecting(
	childId: ChildId,
	cardId: string,
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
				eq(schema.stampCards.id, Number(cardId)),
				eq(schema.stampCards.childId, Number(childId)),
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
