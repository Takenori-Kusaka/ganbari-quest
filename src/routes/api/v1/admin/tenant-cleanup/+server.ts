// src/routes/api/v1/admin/tenant-cleanup/+server.ts
// 退会 (アカウント削除) 猶予満了テナントのデータ完全削除バッチ（手動トリガー用）
//
// #3993: 旧実装は独自に「`status === grace_period` かつ `planExpiresAt < now`」で削除対象を
// 選んでいた。しかし `grace_period` は **支払い失敗の dunning 猶予**でも書かれるため
// (`handlePaymentFailed`)、**カードの期限切れで決済が失敗しただけのテナントが物理削除の
// 対象に入っていた**。退会申請の有無を一切見ていなかった。
//
// 退会申請の状態は `families.status` ではなく settings の `soft_deleted_at` /
// `physical_deletion_date` が持つ (`grace-period-service.softDeleteTenant` は families を
// 触らない)。その条件で削除する実装は **既に `purgeExpiredSoftDeletedTenants()` に存在する**。
//
// したがって本 endpoint は条件を書き直すのではなく **委譲する**。旧実装を残して条件だけ
// 直すと同じ処理が 2 実装に分かれ、しかも本 endpoint 側には以下が無い:
//   - 件数上限 / 時間予算による self-limiting (#3695)
//   - owner / 他メンバーを区別した削除 (account-deletion-service 経由)
//   - 失敗テナントの errors 収集と次回持ち越し
//
// 正規の定期実行は `/api/cron/grace-period-deletion` (同じ service を呼ぶ)。本 endpoint は
// 手動トリガーの入口として残す。**EventBridge Rule は本 endpoint には無い** (#4033 参照)。

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { purgeExpiredSoftDeletedTenants } from '$lib/server/services/grace-period-service';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
	// 既定 true は維持 (誤爆で物理削除を走らせない)。
	const dryRun = body.dryRun ?? true;

	try {
		const result = await purgeExpiredSoftDeletedTenants({ dryRun });
		logger.info('[tenant-cleanup] バッチ完了', { context: { ...result, dryRun } });
		return json({ success: true, ...result });
	} catch (err) {
		logger.error('[tenant-cleanup] バッチ失敗', { error: String(err) });
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
