import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
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
 *
 * #4435 (逸脱 2、条件 SSOT: parallel-implementations.md §13 条件 1): `shown_at IS NULL` guard で
 * 冪等にし、再送 (`postShown` は失敗時 1 回再送する) で「最初に見せた時刻」を上書きしない。
 * guard で 0 行になった場合は所有権を満たす行を読み直して返す —「既に既読」と「他人の子の行」を
 * 呼び出し側 (`/shown` endpoint の 404) が区別できなくなるのを防ぐため。
 */
export async function markMessageShown(
	childId: ChildId,
	messageId: string,
	_tenantId: string,
): Promise<ParentMessage | undefined> {
	const owned = and(
		eq(parentMessages.id, Number(messageId)),
		eq(parentMessages.childId, Number(childId)),
	);
	const row = db
		.update(parentMessages)
		.set({ shownAt: new Date().toISOString() })
		.where(and(owned, isNull(parentMessages.shownAt)))
		.returning()
		.get();
	if (row) return toMessage(row);
	const already = db.select().from(parentMessages).where(owned).get();
	return already ? toMessage(already) : undefined;
}

/** テナントの全メッセージを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(parentMessages).run();
}
