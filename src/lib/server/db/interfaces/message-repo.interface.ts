import type { ChildId } from '$lib/domain/ids';
import type { InsertParentMessageInput, ParentMessage } from '../types';

export interface IMessageRepo {
	insertMessage(input: InsertParentMessageInput, tenantId: string): Promise<ParentMessage>;

	/**
	 * #3329 backup restore 用: sentAt / shownAt を保全して親→子メッセージを復元する。
	 * insertMessage は sentAt を schema default (now) で発番し shownAt を null 固定するため round-trip で
	 * 送信日時・既読状態が失われる。本メソッドは export された値をそのまま書き戻す (id は新規採番、
	 * childId は呼び出し側が解決済)。
	 *
	 * #3394/#3414 統一冪等契約: 永続化しなかった場合 (demo no-op stub) は **null** を返し、
	 * import カウントを偽装しない (#2263 class)。id-addressable append のため DB 自然キーは
	 * 持たず、同一 backup 再取込の重複は import-service の content dedup (merge mode) が防ぐ。
	 * write 失敗は throw する (#3401)。
	 */
	insertForRestore(
		input: Omit<ParentMessage, 'id'>,
		tenantId: string,
	): Promise<ParentMessage | null>;

	findMessages(childId: ChildId, limit: number, tenantId: string): Promise<ParentMessage[]>;
	findUnshownMessage(childId: ChildId, tenantId: string): Promise<ParentMessage | undefined>;
	countUnshownMessages(childId: ChildId, tenantId: string): Promise<number>;
	/**
	 * #2845 課題①: full composite-key addressing。childId + messageId の複合キーで対象を
	 * 直接特定し、repo 入口で child 所有権を構造的に検証する (id-only mutation 禁止)。
	 * (childId, messageId) が不一致なら更新せず undefined を返す。
	 */
	markMessageShown(
		childId: ChildId,
		messageId: string,
		tenantId: string,
	): Promise<ParentMessage | undefined>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
