import type { ChildId } from '$lib/domain/ids';
// Demo IStampCardRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
// #2097 Phase B-2: 当週 active card + 前週 redeemed card の fixture を返す。

import {
	DEMO_STAMP_CARDS,
	DEMO_STAMP_ENTRIES,
	DEMO_STAMP_MASTERS,
} from '$lib/server/demo/demo-data';
import type {
	InsertStampCardInput,
	InsertStampEntryInput,
	StampCard,
	StampEntryWithMaster,
	StampMaster,
	UpdateStampCardStatusInput,
} from '../types';

export async function findEnabledStampMasters(_tenantId: string): Promise<StampMaster[]> {
	return DEMO_STAMP_MASTERS.filter((m) => m.isEnabled === 1);
}

export async function findCardByChildAndWeek(
	childId: ChildId,
	weekStart: string,
	_tenantId: string,
): Promise<StampCard | undefined> {
	return DEMO_STAMP_CARDS.find((c) => c.childId === childId && c.weekStart === weekStart);
}

export async function insertCard(
	input: InsertStampCardInput,
	_tenantId: string,
): Promise<StampCard> {
	const now = new Date().toISOString();
	return {
		id: '0',
		childId: input.childId,
		weekStart: input.weekStart,
		weekEnd: input.weekEnd,
		status: input.status ?? 'collecting',
		redeemedPoints: null,
		redeemedAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

export async function findEntriesWithMasterByCardId(
	cardId: string,
	_tenantId: string,
): Promise<StampEntryWithMaster[]> {
	const entries = DEMO_STAMP_ENTRIES.filter((e) => e.cardId === cardId);
	return entries.map((e) => {
		const master = DEMO_STAMP_MASTERS.find((m) => m.id === e.stampMasterId);
		return {
			slot: e.slot,
			stampMasterId: e.stampMasterId,
			omikujiRank: e.omikujiRank,
			loginDate: e.loginDate,
			name: master?.name ?? null,
			emoji: master?.emoji ?? null,
			rarity: master?.rarity ?? null,
		};
	});
}

export async function insertEntry(_input: InsertStampEntryInput, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function findCardsByChild(childId: ChildId, _tenantId: string): Promise<StampCard[]> {
	return DEMO_STAMP_CARDS.filter((c) => c.childId === childId);
}

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
	return DEMO_STAMP_ENTRIES.filter((e) => e.cardId === cardId).map((e) => ({
		stampMasterId: e.stampMasterId,
		omikujiRank: e.omikujiRank,
		slot: e.slot,
		loginDate: e.loginDate,
		earnedAt: (e as { earnedAt?: string }).earnedAt ?? '',
	}));
}

export async function insertCardForRestore(
	_input: Omit<StampCard, 'id'>,
	_tenantId: string,
): Promise<StampCard | null> {
	// Stub: demo は書き込み no-op。#3394: 永続化していないため null を返し
	// import カウント (stampCardsImported) を偽装しない (#2263 count 偽装 class)。
	return null;
}

export async function insertEntryForRestore(
	_input: {
		cardId: string;
		stampMasterId: string | null;
		omikujiRank: string | null;
		slot: number;
		loginDate: string;
		earnedAt: string;
	},
	_tenantId: string,
): Promise<boolean> {
	// Stub: demo は書き込み no-op。#3394: false を返し stampEntriesImported を偽装しない。
	return false;
}

export async function updateCardStatus(
	_childId: ChildId,
	_cardId: string,
	_input: UpdateStampCardStatusInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function updateCardStatusIfCollecting(
	_childId: ChildId,
	_cardId: string,
	_input: UpdateStampCardStatusInput,
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
