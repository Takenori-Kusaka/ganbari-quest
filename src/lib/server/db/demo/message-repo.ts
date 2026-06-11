// Demo IMessageRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { InsertParentMessageInput, ParentMessage } from '../types';

export async function insertMessage(
	input: InsertParentMessageInput,
	_tenantId: string,
): Promise<ParentMessage> {
	return {
		id: 0,
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
	_childId: number,
	_limit: number,
	_tenantId: string,
): Promise<ParentMessage[]> {
	return [];
}

export async function findUnshownMessage(
	_childId: number,
	_tenantId: string,
): Promise<ParentMessage | undefined> {
	return undefined;
}

export async function countUnshownMessages(_childId: number, _tenantId: string): Promise<number> {
	return 0;
}

export async function markMessageShown(
	_childId: number,
	_messageId: number,
	_tenantId: string,
): Promise<ParentMessage | undefined> {
	return undefined;
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
