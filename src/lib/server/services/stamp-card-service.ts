// src/lib/server/services/stamp-card-service.ts
// スタンプカードサービス層 — ビジネスロジックのみ。DB操作はリポジトリfacade経由

import { todayDateJST } from '$lib/domain/date-utils';
import { insertPointEntry } from '$lib/server/db/point-repo';
import {
	findCardByChildAndWeek,
	findEnabledStampMasters,
	findEntriesWithMasterByCardId,
	insertCard,
	insertEntry,
	updateCardStatusIfCollecting,
} from '$lib/server/db/stamp-card-repo';
import { logger } from '$lib/server/logger';

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

/** 押印時に即座に付与されるポイント（固定） */
const INSTANT_STAMP_POINTS = 5;
/** 週末redeem時のレアリティ別ボーナス基礎値 */
const RARITY_BONUS_PER_STAMP = 5;
/** 7/7コンプリートボーナス（週末redeem時） */
const COMPLETE_BONUS = 50;
/** 週間スロット数（月〜日の7日） */
const MAX_SLOTS = 7;

export interface StampMasterData {
	id: number;
	name: string;
	emoji: string;
	rarity: string;
}

export interface StampEntryData {
	slot: number;
	stampMasterId: number | null;
	omikujiRank: string | null;
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
	const d = new Date(`${dateStr}T00:00:00Z`);
	const day = d.getUTCDay();
	const diffToMonday = day === 0 ? -6 : 1 - day;
	const monday = new Date(d);
	monday.setUTCDate(d.getUTCDate() + diffToMonday);
	const sunday = new Date(monday);
	sunday.setUTCDate(monday.getUTCDate() + 6);
	const fmt = (dt: Date) =>
		`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
	return { weekStart: fmt(monday), weekEnd: fmt(sunday) };
}

/** レア度に応じたランダムスタンプ選出 */
function pickRandomStamp(stamps: StampMasterData[]): StampMasterData {
	// レア度ごとにスタンプを分類
	const byRarity: Record<string, StampMasterData[]> = {};
	for (const s of stamps) {
		if (!byRarity[s.rarity]) byRarity[s.rarity] = [];
		byRarity[s.rarity]?.push(s);
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
export async function getEnabledStamps(tenantId: string): Promise<StampMasterData[]> {
	const rows = await findEnabledStampMasters(tenantId);
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		emoji: r.emoji,
		rarity: r.rarity,
	}));
}

/** 現在の週のスタンプカードを取得（なければ作成） */
export async function getOrCreateCurrentCard(
	childId: number,
	tenantId: string,
): Promise<StampCardData> {
	const today = todayDateJST();
	const { weekStart, weekEnd } = getWeekRange(today);

	// 既存カードを検索
	let card = await findCardByChildAndWeek(childId, weekStart, tenantId);

	if (!card) {
		// 新しいカードを作成
		card = await insertCard({ childId, weekStart, weekEnd, status: 'collecting' }, tenantId);
	}

	// エントリ取得
	const rawEntries = await findEntriesWithMasterByCardId(card.id, tenantId);

	const entries: StampEntryData[] = rawEntries.map((e) => ({
		slot: e.slot,
		stampMasterId: e.stampMasterId,
		omikujiRank: e.omikujiRank,
		name: e.name ?? e.omikujiRank ?? '?',
		emoji: e.emoji ?? '',
		rarity: e.rarity ?? 'N',
		loginDate: e.loginDate,
	}));

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

/** スタンプを押印する（即時 INSTANT_STAMP_POINTS pt 付与） */
export async function stampToday(
	childId: number,
	tenantId: string,
): Promise<
	| { error: 'ALREADY_STAMPED' | 'CARD_FULL' | 'NOT_COLLECTING' }
	| { stamp: StampEntryData; cardData: StampCardData; instantPoints: number }
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

	// 7枠すべて埋まっている
	if (cardData.filledSlots >= MAX_SLOTS) {
		return { error: 'CARD_FULL' };
	}

	// ランダムスタンプを選出（レアリティで抽選）
	const enabledStamps = await getEnabledStamps(tenantId);
	if (enabledStamps.length === 0) {
		throw new Error('No enabled stamps available');
	}
	const picked = pickRandomStamp(enabledStamps);
	const nextSlot = cardData.filledSlots + 1;

	await insertEntry(
		{
			cardId: cardData.id,
			stampMasterId: picked.id,
			omikujiRank: null,
			slot: nextSlot,
			loginDate: today,
		},
		tenantId,
	);

	const entry: StampEntryData = {
		slot: nextSlot,
		stampMasterId: picked.id,
		omikujiRank: null,
		name: picked.name,
		emoji: picked.emoji,
		rarity: picked.rarity,
		loginDate: today,
	};

	// 即時ポイント付与（毎日の小さな報酬）
	try {
		await insertPointEntry(
			{
				childId,
				amount: INSTANT_STAMP_POINTS,
				type: 'stamp_instant',
				description: `スタンプ押印 +${INSTANT_STAMP_POINTS}pt`,
			},
			tenantId,
		);
	} catch (error) {
		logger.error('[stamp] insertPointEntry failed after stamp insert', {
			error: String(error),
			context: { childId, tenantId, cardId: cardData.id, slot: nextSlot },
		});
	}

	// 更新後のカード取得
	const updatedCard = await getOrCreateCurrentCard(childId, tenantId);

	return { stamp: entry, cardData: updatedCard, instantPoints: INSTANT_STAMP_POINTS };
}

/** スタンプカードの週末 redeem ポイントを計算（レアリティボーナス + コンプリートボーナス） */
function calcCardPoints(
	entries: StampEntryData[],
	loginMultiplier = 1,
): {
	rarityPoints: number;
	completeBonus: number;
	multiplier: number;
	total: number;
} {
	let rarityPoints = 0;
	for (const entry of entries) {
		const rMult = RARITY_MULTIPLIER[entry.rarity] ?? 1;
		rarityPoints += RARITY_BONUS_PER_STAMP * rMult;
	}
	const completeBonus = entries.length >= MAX_SLOTS ? COMPLETE_BONUS : 0;
	const subtotal = rarityPoints + completeBonus;
	const total = Math.round(subtotal * loginMultiplier);
	return { rarityPoints, completeBonus, multiplier: loginMultiplier, total };
}

/** スタンプカードをポイントに交換（週末 redeem: レアリティボーナス + コンプリートボーナス） */
export async function redeemStampCard(
	childId: number,
	tenantId: string,
	loginMultiplier = 1,
): Promise<
	| { error: 'NO_CARD' | 'ALREADY_REDEEMED' | 'EMPTY_CARD' }
	| { points: number; rarityPoints: number; completeBonus: number; multiplier: number }
> {
	const cardData = await getOrCreateCurrentCard(childId, tenantId);

	if (cardData.status === 'redeemed') {
		return { error: 'ALREADY_REDEEMED' };
	}

	if (cardData.entries.length === 0) {
		return { error: 'EMPTY_CARD' };
	}

	const { rarityPoints, completeBonus, multiplier, total } = calcCardPoints(
		cardData.entries,
		loginMultiplier,
	);

	// カードを引き換え済みに更新（冪等ガード: 同時リクエスト対策）
	const now = new Date().toISOString();
	const affected = await updateCardStatusIfCollecting(
		cardData.id,
		{
			status: 'redeemed',
			redeemedPoints: total,
			redeemedAt: now,
			updatedAt: now,
		},
		tenantId,
	);

	if (affected === 0) {
		return { error: 'ALREADY_REDEEMED' as const };
	}

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

	return { points: total, rarityPoints, completeBonus, multiplier };
}

/** 前週のカードを自動 redeem する（月曜初ログイン時に呼ばれる） */
export async function autoRedeemPreviousWeek(
	childId: number,
	tenantId: string,
	loginMultiplier = 1,
): Promise<null | {
	points: number;
	rarityPoints: number;
	completeBonus: number;
	multiplier: number;
	filledSlots: number;
	totalSlots: number;
}> {
	const today = todayDateJST();
	const { weekStart } = getWeekRange(today);

	// 前週の月曜日を算出（UTC固定で計算し、Lambda環境のTZ影響を避ける）
	const prevMonday = new Date(`${weekStart}T00:00:00Z`);
	prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
	const prevWeekStart = `${prevMonday.getUTCFullYear()}-${String(prevMonday.getUTCMonth() + 1).padStart(2, '0')}-${String(prevMonday.getUTCDate()).padStart(2, '0')}`;

	const prevCard = await findCardByChildAndWeek(childId, prevWeekStart, tenantId);
	if (!prevCard || prevCard.status === 'redeemed') {
		return null;
	}

	// 前週カードのエントリを取得
	const rawEntries = await findEntriesWithMasterByCardId(prevCard.id, tenantId);
	if (rawEntries.length === 0) {
		return null;
	}

	const entries: StampEntryData[] = rawEntries.map((e) => ({
		slot: e.slot,
		stampMasterId: e.stampMasterId,
		omikujiRank: e.omikujiRank,
		name: e.name ?? '?',
		emoji: e.emoji ?? '',
		rarity: e.rarity ?? 'N',
		loginDate: e.loginDate,
	}));

	const { rarityPoints, completeBonus, multiplier, total } = calcCardPoints(
		entries,
		loginMultiplier,
	);

	// 冪等ガード: 同時リクエストで二重付与を防ぐ
	const now = new Date().toISOString();
	const affected = await updateCardStatusIfCollecting(
		prevCard.id,
		{ status: 'redeemed', redeemedPoints: total, redeemedAt: now, updatedAt: now },
		tenantId,
	);

	if (affected === 0) {
		return null;
	}

	await insertPointEntry(
		{
			childId,
			amount: total,
			type: 'stamp_card',
			description: `先週のスタンプカード交換 (${entries.length}/${MAX_SLOTS}枠)`,
		},
		tenantId,
	);

	return {
		points: total,
		rarityPoints,
		completeBonus,
		multiplier,
		filledSlots: entries.length,
		totalSlots: MAX_SLOTS,
	};
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
