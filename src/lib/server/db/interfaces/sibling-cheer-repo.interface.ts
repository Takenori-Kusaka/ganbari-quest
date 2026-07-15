import type { ChildId } from '$lib/domain/ids';
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
	 *
	 * #3394/#3420 統一冪等契約: 永続化しなかった場合 (demo no-op stub) は **null** を返し、
	 * import カウントを偽装しない (#2263 class)。id-addressable append のため DB 自然キーは
	 * 持たず、同一 backup 再取込の重複は import-service の content dedup (merge mode) が防ぐ。
	 * write 失敗は throw する (#3401)。
	 */
	insertForRestore(
		input: Omit<SiblingCheer, 'id' | 'tenantId'>,
		tenantId: string,
	): Promise<SiblingCheer | null>;

	findUnshownCheers(toChildId: ChildId, tenantId: string): Promise<SiblingCheer[]>;
	markShown(cheerIds: string[], tenantId: string): Promise<void>;
	countTodayCheersFrom(fromChildId: ChildId, tenantId: string): Promise<number>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
