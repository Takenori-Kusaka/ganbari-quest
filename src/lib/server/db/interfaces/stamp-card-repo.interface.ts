import type {
	InsertStampCardInput,
	InsertStampEntryInput,
	StampCard,
	StampEntryWithMaster,
	StampMaster,
	UpdateStampCardStatusInput,
} from '../types';

export interface IStampCardRepo {
	findEnabledStampMasters(tenantId: string): Promise<StampMaster[]>;
	findCardByChildAndWeek(
		childId: number,
		weekStart: string,
		tenantId: string,
	): Promise<StampCard | undefined>;
	insertCard(input: InsertStampCardInput, tenantId: string): Promise<StampCard>;
	findEntriesWithMasterByCardId(cardId: number, tenantId: string): Promise<StampEntryWithMaster[]>;
	insertEntry(input: InsertStampEntryInput, tenantId: string): Promise<void>;
	updateCardStatus(
		cardId: number,
		input: UpdateStampCardStatusInput,
		tenantId: string,
	): Promise<void>;
	updateCardStatusIfCollecting(
		cardId: number,
		input: UpdateStampCardStatusInput,
		tenantId: string,
	): Promise<number>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
