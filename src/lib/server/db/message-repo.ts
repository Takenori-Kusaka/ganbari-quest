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
/** #2845 課題①: childId 所有権検証付き (composite key)。不一致なら undefined。 */
export async function markMessageShown(childId: number, messageId: number, tenantId: string) {
	return getRepos().message.markMessageShown(childId, messageId, tenantId);
}
