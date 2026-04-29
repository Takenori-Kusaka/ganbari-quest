// src/routes/api/cron/license-expire/+server.ts
// #821: 期限切れライセンスキー自動失効バッチのクロンエンドポイント
//
// EventBridge (Scheduled Rule, 日次 JST 00:00) または手動実行から呼ばれる。
// 認証は verifyCronAuth (`$lib/server/auth/cron-auth.ts`) を使用。
// `Authorization: Bearer <CRON_SECRET>` と `x-cron-secret: <CRON_SECRET>` の
// 両ヘッダを受け入れる (#1377 Sub A-3 で統一)。
// 移行期間中は後方互換で OPS_SECRET_KEY も許可する (ADR-0033 archive)。
//
// 使い方:
//   POST /api/cron/license-expire
//   Authorization: Bearer <CRON_SECRET>     # AWS cron-dispatcher
//   または
//   x-cron-secret: <CRON_SECRET>            # NUC scheduler / 既存テスト
//   Body (任意): { "dryRun": true }
//
// レスポンス:
//   200 { ok: true, scanned, revoked, failures, dryRun }
//   401 Unauthorized
//   500 Internal Error / CRON_SECRET 未設定 (本番)

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { expireLicenseKeys } from '$lib/server/services/license-key-service';
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

	try {
		const result = await expireLicenseKeys({ dryRun });
		logger.info('[license-expire] endpoint completed', {
			service: 'license-expire',
			context: { scanned: result.scanned, revoked: result.revoked, dryRun },
		});
		return json({ ok: true, ...result });
	} catch (e) {
		logger.error('[license-expire] endpoint failed', {
			service: 'license-expire',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 500 });
	}
};

// GET も許容（ヘルスチェック用、dry-run 実行）
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;
	try {
		const result = await expireLicenseKeys({ dryRun: true });
		return json({ ok: true, ...result });
	} catch (e) {
		logger.error('[license-expire] dry-run endpoint failed', {
			service: 'license-expire',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 500 });
	}
};
