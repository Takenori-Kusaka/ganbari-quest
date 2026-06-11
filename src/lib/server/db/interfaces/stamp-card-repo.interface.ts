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
	/**
	 * #2845 課題①: full composite-key addressing。childId + cardId の複合キーで対象を
	 * 特定し、repo 入口で child 所有権を構造的に検証する。不一致なら no-op。
	 */
	updateCardStatus(
		childId: number,
		cardId: number,
		input: UpdateStampCardStatusInput,
		tenantId: string,
	): Promise<void>;
	/** #2845 課題①: childId 所有権検証付き。不一致 / 非 collecting なら affected=0。 */
	updateCardStatusIfCollecting(
		childId: number,
		cardId: number,
		input: UpdateStampCardStatusInput,
		tenantId: string,
	): Promise<number>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
