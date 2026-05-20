// src/lib/server/db/dynamodb/stamp-card-repo.ts
// DynamoDB implementation of IStampCardRepo
//
// 経緯:
// - #2263 hotfix (PR #2280): 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
//   Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
//   当時「スタンプカード機能は本番未活用」と判断していたが誤判定だった。
// - 後続 Critical (Issue 起票 2026-05-20): 子供 home の自動押印 (`?/loginStamp` action) は本番で
//   active。findEnabledStampMasters が 0 件を返すと stamp-card-service.stampToday が
//   `throw new Error('No enabled stamps available')` で POST 500 を返す状態だった。
//
// 現在の方針 (Pre-PMF Bucket A):
// - **read findEnabledStampMasters**: DEFAULT_STAMP_MASTERS_DATA SSOT から 16 件を合成して返す
//   (本番でも子供 home が動く最小修正、tenant 別カスタマイズ機構なしの Pre-PMF)
// - **write 系**: no-op + logger.warn を維持 (スタンプ獲得履歴の永続化は別 Issue で実装、
//   現状は in-memory で押印演出のみ可能、week 跨ぎで履歴消失するが致命的でない)
// - **その他 read**: 旧 fallback を維持 (空 / undefined)

import { logger } from '$lib/server/logger';
import { getDefaultStampMasters } from '../stamp-master-defaults';
import type {
	InsertStampCardInput,
	InsertStampEntryInput,
	StampCard,
	StampEntryWithMaster,
	StampMaster,
	UpdateStampCardStatusInput,
} from '../types';

const SERVICE = 'stamp-card-repo.dynamodb';

function warnRead(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] read fallback: returning empty (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

function warnWrite(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] write fallback: no-op (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

/**
 * 有効な stamp master 一覧を返す。
 *
 * Pre-PMF Bucket A: tenant 別カスタマイズ機構は未実装のため
 * DEFAULT_STAMP_MASTERS_DATA SSOT (16 件) を全 tenant 共通で返す。
 * これにより本番 cognito Lambda の `?/loginStamp` action POST 500 を回避する
 * (空配列を返すと stamp-card-service.stampToday が throw する設計のため、
 *  空でなく default を返すのが最も安全)。
 */
export async function findEnabledStampMasters(_tenantId: string): Promise<StampMaster[]> {
	return getDefaultStampMasters();
}

export async function findCardByChildAndWeek(
	childId: number,
	weekStart: string,
	tenantId: string,
): Promise<StampCard | undefined> {
	warnRead('findCardByChildAndWeek', { childId, weekStart, tenantId });
	return undefined;
}

export async function insertCard(
	input: InsertStampCardInput,
	tenantId: string,
): Promise<StampCard> {
	warnWrite('insertCard', { childId: input.childId, weekStart: input.weekStart, tenantId });
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
	tenantId: string,
): Promise<StampEntryWithMaster[]> {
	warnRead('findEntriesWithMasterByCardId', { cardId, tenantId });
	return [];
}

export async function insertEntry(input: InsertStampEntryInput, tenantId: string): Promise<void> {
	warnWrite('insertEntry', { cardId: input.cardId, slot: input.slot, tenantId });
}

export async function updateCardStatus(
	cardId: number,
	input: UpdateStampCardStatusInput,
	tenantId: string,
): Promise<void> {
	warnWrite('updateCardStatus', { cardId, status: input.status, tenantId });
}

export async function updateCardStatusIfCollecting(
	cardId: number,
	input: UpdateStampCardStatusInput,
	tenantId: string,
): Promise<number> {
	warnWrite('updateCardStatusIfCollecting', { cardId, status: input.status, tenantId });
	return 0;
}

/** テナントの全スタンプカード・エントリを削除（Pre-PMF fallback: no-op） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	warnWrite('deleteByTenantId', { tenantId });
}
