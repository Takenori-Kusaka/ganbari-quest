// src/routes/api/cron/export-build/+server.ts
// #3504 (async-backup-export.md §3.2): クラウドエクスポートの背景 build クロンエンドポイント。
//
// EventBridge (cron-dispatcher) / NUC scheduler から定期的に呼ばれ、status='pending' の
// クラウドエクスポートを最大 limit 件 build して status='ready' (失敗時 'failed') にする。
//
// 使い方:
//   POST /api/cron/export-build   x-cron-secret: <CRON_SECRET>   Body(任意): { "limit": 5, "dryRun": true }
//   200 { ok, processed, ready, failed }
//   401 Unauthorized / 404 secret 未設定 / 500 Internal Error

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { drainPendingExports } from '$lib/server/services/cloud-export-service';
import type { RequestHandler } from './$types';

const DEFAULT_LIMIT = 5;

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	let limit = DEFAULT_LIMIT;
	let dryRun = false;
	try {
		const body = (await request.json().catch(() => ({}))) as { limit?: number; dryRun?: boolean };
		if (typeof body.limit === 'number' && body.limit > 0) limit = Math.floor(body.limit);
		dryRun = body.dryRun ?? false;
	} catch {
		// ボディなしでも可
	}

	if (dryRun) {
		// env 検証のみ (build しない)。deploy 後 smoke test 用。
		return json({ ok: true, dryRun: true, processed: 0, ready: 0, failed: 0 });
	}

	logger.info('[export-build] endpoint started', {
		service: 'export-build',
		context: { limit },
	});

	try {
		const result = await drainPendingExports(limit);
		logger.info('[export-build] endpoint completed', {
			service: 'export-build',
			context: { ...result },
		});
		return json({ ok: true, ...result });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		logger.error('[export-build] endpoint failed', {
			service: 'export-build',
			error: msg,
			stack: e instanceof Error ? e.stack : undefined,
		});
		return json({ ok: false, error: msg }, { status: 500 });
	}
};

// GET はヘルスチェック的用途 (dry-run。build せず 200 を返す)。
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;
	return json({ ok: true, dryRun: true, processed: 0, ready: 0, failed: 0 });
};
