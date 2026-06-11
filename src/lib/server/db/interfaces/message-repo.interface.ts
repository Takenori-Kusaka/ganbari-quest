import type { InsertParentMessageInput, ParentMessage } from '../types';

export interface IMessageRepo {
	insertMessage(input: InsertParentMessageInput, tenantId: string): Promise<ParentMessage>;
	findMessages(childId: number, limit: number, tenantId: string): Promise<ParentMessage[]>;
	findUnshownMessage(childId: number, tenantId: string): Promise<ParentMessage | undefined>;
	countUnshownMessages(childId: number, tenantId: string): Promise<number>;
	/**
	 * #2845 課題①: full composite-key addressing。childId + messageId の複合キーで対象を
	 * 直接特定し、repo 入口で child 所有権を構造的に検証する (id-only mutation 禁止)。
	 * (childId, messageId) が不一致なら更新せず undefined を返す。
	 */
	markMessageShown(
		childId: number,
		messageId: number,
		tenantId: string,
	): Promise<ParentMessage | undefined>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
