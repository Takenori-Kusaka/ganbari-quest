// DynamoDB implementation stubs for parent messages
// TODO: Implement when DynamoDB backend is fully supported

import type { InsertParentMessageInput, ParentMessage } from '../types';

export async function insertMessage(
	_input: InsertParentMessageInput,
	_tenantId: string,
): Promise<ParentMessage> {
	throw new Error('DynamoDB message repo not implemented');
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
	_messageId: number,
	_tenantId: string,
): Promise<ParentMessage | undefined> {
	return undefined;
}
