import type { InsertSiblingCheerInput, SiblingCheer } from '../types';

export interface ISiblingCheerRepo {
	insertCheer(input: InsertSiblingCheerInput, tenantId: string): Promise<SiblingCheer>;

	/** #3329 backup: テナントの全おうえんスタンプ (export 用)。 */
	findAllByTenant(tenantId: string): Promise<SiblingCheer[]>;

	/**
	 * #3329 backup restore 用: sentAt / shownAt を保全して復元する。
	 * insertCheer は sentAt を schema default (now) で発番し shownAt を null 固定するため round-trip で
	 * 送信日時・既読状態が失われる。本メソッドは export された値をそのまま書き戻す (id は新規採番、
	 * from/to childId は呼び出し側が解決済)。
	 */
	insertForRestore(
		input: Omit<SiblingCheer, 'id' | 'tenantId'>,
		tenantId: string,
	): Promise<SiblingCheer>;

	findUnshownCheers(toChildId: number, tenantId: string): Promise<SiblingCheer[]>;
	markShown(cheerIds: number[], tenantId: string): Promise<void>;
	countTodayCheersFrom(fromChildId: number, tenantId: string): Promise<number>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
