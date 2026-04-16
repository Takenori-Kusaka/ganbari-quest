// src/routes/api/cron/license-expire/+server.ts
// #821: 期限切れライセンスキー自動失効バッチのクロンエンドポイント
//
// EventBridge (Scheduled Rule, 日次 JST 00:00) または手動実行から呼ばれる。
// 認証は CRON_SECRET の Bearer token で行う (ADR-0033、retention-cleanup と同じパターン)。
// 移行期間中は後方互換で OPS_SECRET_KEY も許可する。
//
// 使い方:
//   POST /api/cron/license-expire
//   Authorization: Bearer <CRON_SECRET>
//   Body (任意): { "dryRun": true }
//
// レスポンス:
//   200 { ok: true, scanned, revoked, failures, dryRun }
//   401 Unauthorized
//   404 Not Found (CRON_SECRET / OPS_SECRET_KEY のいずれも未設定時)
//   500 Internal Error

import { error, json } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { expireLicenseKeys } from '$lib/server/services/license-key-service';
import type { RequestHandler } from './$types';

function checkAuth(request: Request): void {
	const cronSecret = process.env.CRON_SECRET;
	const legacySecret = process.env.OPS_SECRET_KEY;
	const accepted = [cronSecret, legacySecret].filter((v): v is string => !!v);
	if (accepted.length === 0) {
		error(404, 'Not Found');
	}

	const authHeader = request.headers.get('Authorization');
	const authorized = accepted.some((s) => authHeader === `Bearer ${s}`);
	if (!authorized) {
		error(401, 'Unauthorized');
	}
}

export const POST: RequestHandler = async ({ request }) => {
	checkAuth(request);

	let dryRun = false;
	try {
		const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
		dryRun = body.dryRun ?? false;
	} catch {
		// ボディなしでも可
	}

	try {
		const result = await expireLicenseKeys({ dryRun });
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
	checkAuth(request);
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
