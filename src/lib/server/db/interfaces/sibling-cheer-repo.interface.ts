import type { ChildId } from '$lib/domain/ids';

/**
 * きょうだい間おうえん (sibling_cheers)。
 *
 * #4691: 送信 UI が存在せず (送信 action / service / 受信 overlay を撤去)、機能として提供しない。
 * 既存テナントに残る行を退会・データ削除で確実に消すため、削除 API だけを残す
 * (表は空のまま残置、schema 変更なし)。
 */
export interface ISiblingCheerRepo {
	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;
}
