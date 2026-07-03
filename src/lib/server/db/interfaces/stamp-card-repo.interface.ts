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

	/** #3329 backup: child の全スタンプカード (status / 期間問わず)。 */
	findCardsByChild(childId: number, tenantId: string): Promise<StampCard[]>;

	/** #3329 backup: card に紐づく押印 raw 行 (master join せず earnedAt まで保全)。 */
	findEntriesByCardId(
		cardId: number,
		tenantId: string,
	): Promise<
		Array<{
			stampMasterId: number | null;
			omikujiRank: string | null;
			slot: number;
			loginDate: string;
			earnedAt: string;
		}>
	>;

	/**
	 * #3329 backup restore 用: status / redeemedPoints / redeemedAt / 日時を保全して card を復元する。
	 * insertCard は status 既定化 + redeemed/日時を保持しないため round-trip で交換済状態が失われる。
	 * id は新規採番、childId は呼び出し側が解決済。
	 */
	insertCardForRestore(input: Omit<StampCard, 'id'>, tenantId: string): Promise<StampCard>;

	/** #3329 backup restore 用: earnedAt を保全して押印を復元する (cardId は復元後の card を指す)。 */
	insertEntryForRestore(
		input: {
			cardId: number;
			stampMasterId: number | null;
			omikujiRank: string | null;
			slot: number;
			loginDate: string;
			earnedAt: string;
		},
		tenantId: string,
	): Promise<void>;
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
