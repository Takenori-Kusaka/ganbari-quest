// src/lib/server/services/child-data-reset-service.ts
// 子供 1 人分の進捗データ (活動ログ / ポイント台帳 / ログインボーナス / 実績解除履歴) を
// クリアする dev-only デバッグサービス (#3152)。
//
// 経緯: 元々 src/routes/switch/+page.server.ts の `resetChild` action 内で
// `db.delete(...).where(eq(...))` を **route から raw ORM 直呼び** していた
// (dynamic import 経由のため route↔DB 境界 fitness function をすり抜けていた)。
// CLAUDE.md / ADR-0061 の「routes は ORM を直接使用しない (services / db facade 経由)」
// に整合させるため、raw ORM 操作を本サービス層へ移譲した。
//
// tenant scoping: 削除対象 4 テーブルは child_id のみで scope され tenant_id カラムを
// 持たないため、**削除前に getChildById(childId, tenantId) で該当 child が呼び出し元
// tenant に属することを検証** し、cross-tenant の childId に対する削除を防ぐ
// (route 側の requireTenantId による auth gate + 本検証の二段で tenant 境界を担保)。

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { activityLogs, childAchievements, loginBonuses, pointLedger } from '$lib/server/db/schema';
import { getChildById } from './child-service';

export interface ResetChildDataResult {
	/** 対象 child が tenant に存在し削除を実行したか (cross-tenant / 不在なら false) */
	reset: boolean;
	childId: number;
}

/**
 * 指定 child の進捗データ (activity_logs / point_ledger / login_bonuses /
 * child_achievements) を全削除する。child 行自体は残す。
 *
 * dev-only デバッグ用途 (route 側で `if (!dev)` ガード済)。
 *
 * @param childId 対象の子供 ID
 * @param tenantId 呼び出し元テナント ID (cross-tenant 削除防止のため必須)
 * @returns 削除実行可否と childId。対象 child が tenant に存在しない場合 reset=false
 */
export async function resetChildData(
	childId: number,
	tenantId: string,
): Promise<ResetChildDataResult> {
	// cross-tenant の childId に対する削除を防ぐため、child の所属 tenant を検証する。
	const child = await getChildById(childId, tenantId);
	if (!child) {
		return { reset: false, childId };
	}

	db.delete(activityLogs).where(eq(activityLogs.childId, childId)).run();
	db.delete(pointLedger).where(eq(pointLedger.childId, childId)).run();
	db.delete(loginBonuses).where(eq(loginBonuses.childId, childId)).run();
	db.delete(childAchievements).where(eq(childAchievements.childId, childId)).run();

	return { reset: true, childId };
}
