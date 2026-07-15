import type { ChildId } from '$lib/domain/ids';
// Demo IMessageRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { InsertParentMessageInput, ParentMessage } from '../types';

export async function insertForRestore(
	_input: Omit<ParentMessage, 'id'>,
	_tenantId: string,
): Promise<ParentMessage | null> {
	// Stub: demo は書き込み no-op。#3394/#3420: 永続化していないため null を返し
	// import カウント (parentMessagesImported) を偽装しない (#2263 count 偽装 class)。
	return null;
}

export async function insertMessage(
	input: InsertParentMessageInput,
	_tenantId: string,
): Promise<ParentMessage> {
	return {
		id: '0',
		childId: input.childId,
		messageType: input.messageType,
		stampCode: input.stampCode ?? null,
		body: input.body ?? null,
		icon: input.icon ?? '💌',
		sentAt: new Date().toISOString(),
		shownAt: null,
		// #2267 (EPIC #2266): 応援機能 (cheer) の新カラム (demo stub では NULL を返す)
		bonusPoints: input.bonusPoints ?? null,
		rewardCategory: input.rewardCategory ?? null,
	};
}

export async function findMessages(
	_childId: ChildId,
	_limit: number,
	_tenantId: string,
): Promise<ParentMessage[]> {
	return [];
}

export async function findUnshownMessage(
	_childId: ChildId,
	_tenantId: string,
): Promise<ParentMessage | undefined> {
	return undefined;
}

export async function countUnshownMessages(_childId: ChildId, _tenantId: string): Promise<number> {
	return 0;
}

export async function markMessageShown(
	_childId: ChildId,
	_messageId: string,
	_tenantId: string,
): Promise<ParentMessage | undefined> {
	return undefined;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
