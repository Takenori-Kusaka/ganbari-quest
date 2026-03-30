// src/lib/server/db/message-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertParentMessageInput } from './types';

export async function insertMessage(input: InsertParentMessageInput, tenantId: string) {
	return getRepos().message.insertMessage(input, tenantId);
}
export async function findMessages(childId: number, limit: number, tenantId: string) {
	return getRepos().message.findMessages(childId, limit, tenantId);
}
export async function findUnshownMessage(childId: number, tenantId: string) {
	return getRepos().message.findUnshownMessage(childId, tenantId);
}
export async function countUnshownMessages(childId: number, tenantId: string) {
	return getRepos().message.countUnshownMessages(childId, tenantId);
}
export async function markMessageShown(messageId: number, tenantId: string) {
	return getRepos().message.markMessageShown(messageId, tenantId);
}
