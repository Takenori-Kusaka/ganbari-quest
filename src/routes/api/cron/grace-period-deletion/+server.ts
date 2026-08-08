// src/routes/api/cron/grace-period-deletion/+server.ts
// #1648 R43: グレースピリオド期限切れテナントの物理削除クロンエンドポイント
//
// EventBridge (Scheduled Rule, #1376) または手動実行から呼ばれる。
// 認証は x-cron-secret ヘッダで行う（verifyCronAuth 共通ヘルパー）。
//
// 背景:
//   grace-period-service.ts の findExpiredSoftDeletedTenants() は実装済だが、
//   それを呼び出す cron が存在せず、解約後の物理削除が実行されていなかった。
//   pricing.html / labels.ts の「7/30 日後にデータ完全削除」訴求と実装の乖離を解消し、
//   個人情報保護法 22 条の遵守 + DB 肥大化リスクの解消を目的とする。
//
// 使い方:
//   POST /api/cron/grace-period-deletion
//   x-cron-secret: <CRON_SECRET>
//   Body (任意): { "dryRun": true }
//
// #4338: スケジューラからの自動実行は `x-cron-trigger: scheduled` を付ける (cron-trigger.ts)。
// 付いていない呼び出しは「人が手で叩いた」として削除記録に `manual` で残る。運用者が手動で
// 叩くときにこのヘッダを真似て付けてはならない (記録が定時実行と区別できなくなる)。
//
// レスポンス:
//   200 { tenantsProcessed, tenantsDeleted, tenantsFailed, expired, errors }
//   401 Unauthorized
//   404 Not Found (CRON_SECRET / OPS_SECRET_KEY のいずれも未設定時)
//   500 Internal Error

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { isScheduledCronTrigger } from '$lib/server/cron/cron-trigger';
import { sendDiscordAlert } from '$lib/server/discord-alert';
import { logger } from '$lib/server/logger';
import {
	GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM,
	purgeExpiredSoftDeletedTenants,
} from '$lib/server/services/grace-period-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	let dryRun = false;
	try {
		const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
		dryRun = body.dryRun ?? false;
	} catch {
		// ボディなしでも可
	}

	// #4338: 削除記録に残す経路。スケジューラ (EventBridge dispatcher / NUC scheduler) は
	// 自分が自動であることを marker ヘッダで名乗る。marker が無い呼び出しは人が手で叩いたもの
	// として `manual` で記録する (判定と「既定を manual にする理由」は cron-trigger.ts)。
	const route = isScheduledCronTrigger(request) ? 'grace-expiry' : 'manual';

	try {
		const result = await purgeExpiredSoftDeletedTenants({ dryRun, route });

		// #4327: 部分失敗 (tenantsFailed > 0) を 200 に埋めない。
		// dispatcher は 2xx を成功として扱うため、200 で返すとどの alarm にも乗らず
		// 「途中まで消えたテナント」が誰にも観測されないまま残る。500 で返して
		// dispatcher Lambda の Errors metric (既存 alarm) に載せる。
		// 本文は同じ shape のまま返し、どのテナントが失敗したかを errors[] で残す。
		if (result.tenantsFailed > 0) {
			logger.error(GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM, {
				service: 'grace-period-deletion',
				context: {
					tenantsProcessed: result.tenantsProcessed,
					tenantsDeleted: result.tenantsDeleted,
					tenantsFailed: result.tenantsFailed,
					failedTenantIds: result.errors.map((e) => e.tenantId),
				},
			});
			// 既存の incident 経路に載せる (新規通知機構は作らない)。
			// payload に tenantId 等の顧客識別子は載せない (discord-alert.ts の設計制約)。
			// 調査は CloudWatch Logs の同 log 行 (failedTenantIds 付き) から行う。
			await sendDiscordAlert({
				level: 'critical',
				message: '顧客データの物理削除が途中で失敗しました (grace-period-deletion)',
				details: `処理 ${result.tenantsProcessed} 件 / 削除成功 ${result.tenantsDeleted} 件 / 失敗 ${result.tenantsFailed} 件`,
			}).catch(() => {
				// 通知の失敗で 500 応答自体を潰さない (500 は dispatcher の Errors alarm に載る)。
			});
			return json({ ok: false, ...result }, { status: 500 });
		}

		return json({
			ok: true,
			...result,
		});
	} catch (e) {
		logger.error('[grace-period-deletion] endpoint failed', {
			service: 'grace-period-deletion',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 500 });
	}
};

// GET も許容（ヘルスチェック用途。dry-run 実行）
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;
	try {
		const result = await purgeExpiredSoftDeletedTenants({ dryRun: true });
		return json({
			ok: true,
			...result,
		});
	} catch (e) {
		logger.error('[grace-period-deletion] dry-run endpoint failed', {
			service: 'grace-period-deletion',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 500 });
	}
};
