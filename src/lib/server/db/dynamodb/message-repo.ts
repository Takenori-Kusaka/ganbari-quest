// DynamoDB implementation of IMessageRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// 親→子メッセージ機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import { logger } from '$lib/server/logger';
import type { InsertParentMessageInput, ParentMessage } from '../types';

const SERVICE = 'message-repo.dynamodb';

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

export async function insertMessage(
	input: InsertParentMessageInput,
	tenantId: string,
): Promise<ParentMessage> {
	warnWrite('insertMessage', { childId: input.childId, messageType: input.messageType, tenantId });
	return {
		id: 0,
		childId: input.childId,
		messageType: input.messageType,
		stampCode: input.stampCode ?? null,
		body: input.body ?? null,
		icon: input.icon ?? '💌',
		sentAt: new Date().toISOString(),
		shownAt: null,
		// #2267 (EPIC #2266): cheer 機能の新カラム (Pre-PMF fallback では NULL を返す)
		bonusPoints: input.bonusPoints ?? null,
		rewardCategory: input.rewardCategory ?? null,
	};
}

export async function findMessages(
	childId: number,
	limit: number,
	tenantId: string,
): Promise<ParentMessage[]> {
	warnRead('findMessages', { childId, limit, tenantId });
	return [];
}

export async function findUnshownMessage(
	childId: number,
	tenantId: string,
): Promise<ParentMessage | undefined> {
	warnRead('findUnshownMessage', { childId, tenantId });
	return undefined;
}

export async function countUnshownMessages(childId: number, tenantId: string): Promise<number> {
	warnRead('countUnshownMessages', { childId, tenantId });
	return 0;
}

export async function markMessageShown(
	messageId: number,
	tenantId: string,
): Promise<ParentMessage | undefined> {
	warnWrite('markMessageShown', { messageId, tenantId });
	return undefined;
}

/** テナントの全メッセージを削除（Pre-PMF fallback: no-op） */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	warnWrite('deleteByTenantId', { tenantId });
}
