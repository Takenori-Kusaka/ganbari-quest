import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { parentMessages } from '../schema';

/** おうえんメッセージを送信（保存） */
export async function insertMessage(
	input: {
		childId: number;
		messageType: string;
		stampCode?: string | null;
		body?: string | null;
		icon?: string;
	},
	_tenantId: string,
) {
	return db.insert(parentMessages).values(input).returning().get();
}

/** 子供のメッセージ履歴を取得（降順） */
export async function findMessages(childId: number, limit: number, _tenantId: string) {
	return db
		.select()
		.from(parentMessages)
		.where(eq(parentMessages.childId, childId))
		.orderBy(desc(parentMessages.sentAt))
		.limit(limit)
		.all();
}

/** 子供の未表示メッセージを1件取得（最新） */
export async function findUnshownMessage(childId: number, _tenantId: string) {
	return db
		.select()
		.from(parentMessages)
		.where(and(eq(parentMessages.childId, childId), isNull(parentMessages.shownAt)))
		.orderBy(desc(parentMessages.sentAt))
		.limit(1)
		.get();
}

/** 未表示メッセージ数を取得 */
export async function countUnshownMessages(childId: number, _tenantId: string) {
	const result = db
		.select({ count: sql<number>`count(*)` })
		.from(parentMessages)
		.where(and(eq(parentMessages.childId, childId), isNull(parentMessages.shownAt)))
		.get();
	return result?.count ?? 0;
}

/** メッセージを表示済みにする */
export async function markMessageShown(messageId: number, _tenantId: string) {
	return db
		.update(parentMessages)
		.set({ shownAt: new Date().toISOString() })
		.where(eq(parentMessages.id, messageId))
		.returning()
		.get();
}

/** テナントの全メッセージを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(parentMessages).run();
}
