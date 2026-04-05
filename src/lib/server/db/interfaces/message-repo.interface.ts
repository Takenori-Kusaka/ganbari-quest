import type { InsertParentMessageInput, ParentMessage } from '../types';

export interface IMessageRepo {
	insertMessage(input: InsertParentMessageInput, tenantId: string): Promise<ParentMessage>;
	findMessages(childId: number, limit: number, tenantId: string): Promise<ParentMessage[]>;
	findUnshownMessage(childId: number, tenantId: string): Promise<ParentMessage | undefined>;
	countUnshownMessages(childId: number, tenantId: string): Promise<number>;
	markMessageShown(messageId: number, tenantId: string): Promise<ParentMessage | undefined>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
