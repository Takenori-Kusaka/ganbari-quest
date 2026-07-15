import type { ChildId } from '$lib/domain/ids';
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
		childId: ChildId,
		weekStart: string,
		tenantId: string,
	): Promise<StampCard | undefined>;
	insertCard(input: InsertStampCardInput, tenantId: string): Promise<StampCard>;
	findEntriesWithMasterByCardId(cardId: string, tenantId: string): Promise<StampEntryWithMaster[]>;
	insertEntry(input: InsertStampEntryInput, tenantId: string): Promise<void>;

	/** #3329 backup: child の全スタンプカード (status / 期間問わず)。 */
	findCardsByChild(childId: ChildId, tenantId: string): Promise<StampCard[]>;

	/** #3329 backup: card に紐づく押印 raw 行 (master join せず earnedAt まで保全)。 */
	findEntriesByCardId(
		cardId: string,
		tenantId: string,
	): Promise<
		Array<{
			stampMasterId: string | null;
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
	 *
	 * #3394 統一冪等契約: 同 (childId, weekStart) が既存なら **null** を返す (重複 skip。
	 * SQLite=uniqueIndex / DynamoDB=attribute_not_exists / DSQL=stamp_cards_week_uq で機能等価)。
	 * その他の write 失敗は throw する (throttle silent loss 禁止、#3401)。
	 */
	insertCardForRestore(input: Omit<StampCard, 'id'>, tenantId: string): Promise<StampCard | null>;

	/**
	 * #3329 backup restore 用: earnedAt を保全して押印を復元する (cardId は復元後の card を指す)。
	 * #3394 統一冪等契約: 実際に insert したら true / 重複 ((cardId,slot) or (cardId,loginDate)) で
	 * skip したら false を返す (import カウントは true のときのみ加算 = count 偽装防止 #2263 class)。
	 * その他の write 失敗は throw する (#3401)。
	 */
	insertEntryForRestore(
		input: {
			cardId: string;
			stampMasterId: string | null;
			omikujiRank: string | null;
			slot: number;
			loginDate: string;
			earnedAt: string;
		},
		tenantId: string,
	): Promise<boolean>;
	/**
	 * #2845 課題①: full composite-key addressing。childId + cardId の複合キーで対象を
	 * 特定し、repo 入口で child 所有権を構造的に検証する。不一致なら no-op。
	 */
	updateCardStatus(
		childId: ChildId,
		cardId: string,
		input: UpdateStampCardStatusInput,
		tenantId: string,
	): Promise<void>;
	/** #2845 課題①: childId 所有権検証付き。不一致 / 非 collecting なら affected=0。 */
	updateCardStatusIfCollecting(
		childId: ChildId,
		cardId: string,
		input: UpdateStampCardStatusInput,
		tenantId: string,
	): Promise<number>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
