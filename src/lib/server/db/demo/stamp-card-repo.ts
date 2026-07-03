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
	childId: number,
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
		id: 0,
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
	cardId: number,
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

export async function findCardsByChild(childId: number, _tenantId: string): Promise<StampCard[]> {
	return DEMO_STAMP_CARDS.filter((c) => c.childId === childId);
}

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
	return DEMO_STAMP_ENTRIES.filter((e) => e.cardId === cardId).map((e) => ({
		stampMasterId: e.stampMasterId,
		omikujiRank: e.omikujiRank,
		slot: e.slot,
		loginDate: e.loginDate,
		earnedAt: (e as { earnedAt?: string }).earnedAt ?? '',
	}));
}

export async function insertCardForRestore(
	input: Omit<StampCard, 'id'>,
	_tenantId: string,
): Promise<StampCard> {
	// Stub: demo は書き込み no-op。引数の状態を反映した row を返す。
	return { ...input, id: 0 };
}

export async function insertEntryForRestore(
	_input: {
		cardId: number;
		stampMasterId: number | null;
		omikujiRank: string | null;
		slot: number;
		loginDate: string;
		earnedAt: string;
	},
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function updateCardStatus(
	_childId: number,
	_cardId: number,
	_input: UpdateStampCardStatusInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function updateCardStatusIfCollecting(
	_childId: number,
	_cardId: number,
	_input: UpdateStampCardStatusInput,
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
