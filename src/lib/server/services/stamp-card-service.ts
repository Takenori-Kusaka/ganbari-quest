// src/lib/server/services/stamp-card-service.ts
// スタンプカードサービス層

import { todayDateJST } from '$lib/domain/date-utils';
import { db } from '$lib/server/db/client';
import { insertPointEntry } from '$lib/server/db/point-repo';
import * as schema from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

// レア度別排出確率
const RARITY_WEIGHTS: Record<string, number> = {
	N: 60,
	R: 25,
	SR: 12,
	UR: 3,
};

// レア度別ポイント倍率
const RARITY_MULTIPLIER: Record<string, number> = {
	N: 1,
	R: 2,
	SR: 4,
	UR: 8,
};

const BASE_POINTS_PER_STAMP = 10;
const COMPLETE_BONUS = 30;
const MAX_SLOTS = 5;

export interface StampMasterData {
	id: number;
	name: string;
	emoji: string;
	rarity: string;
}

export interface StampEntryData {
	slot: number;
	stampMasterId: number;
	name: string;
	emoji: string;
	rarity: string;
	loginDate: string;
}

export interface StampCardData {
	id: number;
	childId: number;
	weekStart: string;
	weekEnd: string;
	status: string;
	entries: StampEntryData[];
	canStampToday: boolean;
	totalSlots: number;
	filledSlots: number;
	redeemedPoints: number | null;
}

/** 今週の月曜日と日曜日を取得 */
function getWeekRange(dateStr: string): { weekStart: string; weekEnd: string } {
	const d = new Date(`${dateStr}T00:00:00`);
	const day = d.getDay();
	const diffToMonday = day === 0 ? -6 : 1 - day;
	const monday = new Date(d);
	monday.setDate(d.getDate() + diffToMonday);
	const sunday = new Date(monday);
	sunday.setDate(monday.getDate() + 6);
	const fmt = (dt: Date) =>
		`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
	return { weekStart: fmt(monday), weekEnd: fmt(sunday) };
}

/** レア度に応じたランダムスタンプ選出 */
function pickRandomStamp(stamps: StampMasterData[]): StampMasterData {
	// レア度ごとにスタンプを分類
	const byRarity: Record<string, StampMasterData[]> = {};
	for (const s of stamps) {
		if (!byRarity[s.rarity]) byRarity[s.rarity] = [];
		byRarity[s.rarity]!.push(s);
	}

	// まずレア度を確率で決定
	const totalWeight = Object.entries(RARITY_WEIGHTS).reduce((sum, [r, w]) => {
		return byRarity[r]?.length ? sum + w : sum;
	}, 0);

	let roll = Math.random() * totalWeight;
	let selectedRarity = 'N';
	for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
		if (!byRarity[rarity]?.length) continue;
		roll -= weight;
		if (roll <= 0) {
			selectedRarity = rarity;
			break;
		}
	}

	// そのレア度内からランダムに1つ選択
	const pool = byRarity[selectedRarity] ?? stamps;
	return pool[Math.floor(Math.random() * pool.length)] as StampMasterData;
}

/** 有効なスタンプマスタ一覧を取得 */
export async function getEnabledStamps(_tenantId: string): Promise<StampMasterData[]> {
	const rows = db
		.select({
			id: schema.stampMasters.id,
			name: schema.stampMasters.name,
			emoji: schema.stampMasters.emoji,
			rarity: schema.stampMasters.rarity,
		})
		.from(schema.stampMasters)
		.where(eq(schema.stampMasters.isEnabled, 1))
		.all();
	return rows;
}

/** 現在の週のスタンプカードを取得（なければ作成） */
export async function getOrCreateCurrentCard(
	childId: number,
	_tenantId: string,
): Promise<StampCardData> {
	const today = todayDateJST();
	const { weekStart, weekEnd } = getWeekRange(today);

	// 既存カードを検索
	let card = db
		.select()
		.from(schema.stampCards)
		.where(and(eq(schema.stampCards.childId, childId), eq(schema.stampCards.weekStart, weekStart)))
		.get();

	if (!card) {
		// 新しいカードを作成
		db.insert(schema.stampCards)
			.values({ childId, weekStart, weekEnd, status: 'collecting' })
			.run();
		card = db
			.select()
			.from(schema.stampCards)
			.where(
				and(eq(schema.stampCards.childId, childId), eq(schema.stampCards.weekStart, weekStart)),
			)
			.get();
	}

	if (!card) {
		throw new Error('Failed to create stamp card');
	}

	// エントリ取得
	const entries = db
		.select({
			slot: schema.stampEntries.slot,
			stampMasterId: schema.stampEntries.stampMasterId,
			loginDate: schema.stampEntries.loginDate,
			name: schema.stampMasters.name,
			emoji: schema.stampMasters.emoji,
			rarity: schema.stampMasters.rarity,
		})
		.from(schema.stampEntries)
		.innerJoin(schema.stampMasters, eq(schema.stampEntries.stampMasterId, schema.stampMasters.id))
		.where(eq(schema.stampEntries.cardId, card.id))
		.all();

	// 今日スタンプ押印済みか確認
	const todayEntry = entries.find((e) => e.loginDate === today);
	const filledSlots = entries.length;

	return {
		id: card.id,
		childId: card.childId,
		weekStart: card.weekStart,
		weekEnd: card.weekEnd,
		status: card.status,
		entries,
		canStampToday: !todayEntry && filledSlots < MAX_SLOTS && card.status === 'collecting',
		totalSlots: MAX_SLOTS,
		filledSlots,
		redeemedPoints: card.redeemedPoints,
	};
}

/** スタンプを押印する */
export async function stampToday(
	childId: number,
	tenantId: string,
): Promise<
	| { error: 'ALREADY_STAMPED' | 'CARD_FULL' | 'NOT_COLLECTING' }
	| { stamp: StampEntryData; cardData: StampCardData }
> {
	const today = todayDateJST();
	const cardData = await getOrCreateCurrentCard(childId, tenantId);

	if (cardData.status !== 'collecting') {
		return { error: 'NOT_COLLECTING' };
	}

	// 今日すでに押印済み
	if (cardData.entries.find((e) => e.loginDate === today)) {
		return { error: 'ALREADY_STAMPED' };
	}

	// 5枠すべて埋まっている
	if (cardData.filledSlots >= MAX_SLOTS) {
		return { error: 'CARD_FULL' };
	}

	// ランダムスタンプを選出
	const enabledStamps = await getEnabledStamps(tenantId);
	if (enabledStamps.length === 0) {
		throw new Error('No enabled stamps available');
	}
	const picked = pickRandomStamp(enabledStamps);
	const nextSlot = cardData.filledSlots + 1;

	// 挿入
	db.insert(schema.stampEntries)
		.values({
			cardId: cardData.id,
			stampMasterId: picked.id,
			slot: nextSlot,
			loginDate: today,
		})
		.run();

	const entry: StampEntryData = {
		slot: nextSlot,
		stampMasterId: picked.id,
		name: picked.name,
		emoji: picked.emoji,
		rarity: picked.rarity,
		loginDate: today,
	};

	// 更新後のカード取得
	const updatedCard = await getOrCreateCurrentCard(childId, tenantId);

	return { stamp: entry, cardData: updatedCard };
}

/** スタンプカードのポイントを計算 */
function calcCardPoints(entries: StampEntryData[]): {
	stampPoints: number;
	completeBonus: number;
	total: number;
} {
	let stampPoints = 0;
	for (const entry of entries) {
		const multiplier = RARITY_MULTIPLIER[entry.rarity] ?? 1;
		stampPoints += BASE_POINTS_PER_STAMP * multiplier;
	}
	const completeBonus = entries.length >= MAX_SLOTS ? COMPLETE_BONUS : 0;
	return { stampPoints, completeBonus, total: stampPoints + completeBonus };
}

/** スタンプカードをポイントに交換 */
export async function redeemStampCard(
	childId: number,
	tenantId: string,
): Promise<
	| { error: 'NO_CARD' | 'ALREADY_REDEEMED' | 'EMPTY_CARD' }
	| { points: number; stampPoints: number; completeBonus: number }
> {
	const cardData = await getOrCreateCurrentCard(childId, tenantId);

	if (cardData.status === 'redeemed') {
		return { error: 'ALREADY_REDEEMED' };
	}

	if (cardData.entries.length === 0) {
		return { error: 'EMPTY_CARD' };
	}

	const { stampPoints, completeBonus, total } = calcCardPoints(cardData.entries);

	// カードを引き換え済みに更新
	db.update(schema.stampCards)
		.set({
			status: 'redeemed',
			redeemedPoints: total,
			redeemedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		})
		.where(eq(schema.stampCards.id, cardData.id))
		.run();

	// ポイント付与
	await insertPointEntry(
		{
			childId,
			amount: total,
			type: 'stamp_card',
			description: `スタンプカード交換 (${cardData.entries.length}/${MAX_SLOTS}枠)`,
		},
		tenantId,
	);

	return { points: total, stampPoints, completeBonus };
}

/** スタンプカードの状態を取得（ホーム画面用の簡易版） */
export async function getStampCardStatus(
	childId: number,
	tenantId: string,
): Promise<StampCardData | null> {
	try {
		return await getOrCreateCurrentCard(childId, tenantId);
	} catch {
		return null;
	}
}
