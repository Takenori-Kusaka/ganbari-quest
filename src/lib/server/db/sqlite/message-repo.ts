import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { type ChildId, asChildId } from '$lib/domain/ids';
import { db } from '../client';
import { parentMessages } from '../schema';
import type { InsertParentMessageInput, ParentMessage } from '../types';

type MessageRow = typeof parentMessages.$inferSelect;

const toMessage = (r: MessageRow): ParentMessage => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
});

/** おうえんメッセージを送信（保存） */
export async function insertMessage(
	input: InsertParentMessageInput,
	_tenantId: string,
): Promise<ParentMessage> {
	return toMessage(
		db
			.insert(parentMessages)
			.values({ ...input, childId: Number(input.childId) })
			.returning()
			.get(),
	);
}

/** #3329 backup restore 用: sentAt / shownAt を保全してメッセージを復元する。 */
export async function insertForRestore(
	input: Omit<ParentMessage, 'id'>,
	_tenantId: string,
): Promise<ParentMessage> {
	return toMessage(
		db
			.insert(parentMessages)
			.values({ ...input, childId: Number(input.childId) })
			.returning()
			.get(),
	);
}

/** 子供のメッセージ履歴を取得（降順） */
export async function findMessages(
	childId: ChildId,
	limit: number,
	_tenantId: string,
): Promise<ParentMessage[]> {
	return db
		.select()
		.from(parentMessages)
		.where(eq(parentMessages.childId, Number(childId)))
		.orderBy(desc(parentMessages.sentAt))
		.limit(limit)
		.all()
		.map(toMessage);
}

/** 子供の未表示メッセージを1件取得（最新） */
export async function findUnshownMessage(
	childId: ChildId,
	_tenantId: string,
): Promise<ParentMessage | undefined> {
	const row = db
		.select()
		.from(parentMessages)
		.where(and(eq(parentMessages.childId, Number(childId)), isNull(parentMessages.shownAt)))
		.orderBy(desc(parentMessages.sentAt))
		.limit(1)
		.get();
	return row ? toMessage(row) : undefined;
}

/** 未表示メッセージ数を取得 */
export async function countUnshownMessages(childId: ChildId, _tenantId: string) {
	const result = db
		.select({ count: sql<number>`count(*)` })
		.from(parentMessages)
		.where(and(eq(parentMessages.childId, Number(childId)), isNull(parentMessages.shownAt)))
		.get();
	return result?.count ?? 0;
}

/**
 * メッセージを表示済みにする。
 * #2845 課題①: childId 所有権検証付き (composite key)。不一致なら更新せず undefined。
 */
export async function markMessageShown(
	childId: ChildId,
	messageId: string,
	_tenantId: string,
): Promise<ParentMessage | undefined> {
	const row = db
		.update(parentMessages)
		.set({ shownAt: new Date().toISOString() })
		.where(
			and(eq(parentMessages.id, Number(messageId)), eq(parentMessages.childId, Number(childId))),
		)
		.returning()
		.get();
	return row ? toMessage(row) : undefined;
}

/** テナントの全メッセージを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(parentMessages).run();
}
