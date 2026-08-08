// src/routes/api/cron/export-build/+server.ts
// #3504 (async-backup-export.md §3.2): クラウドエクスポートの背景 build クロンエンドポイント。
//
// EventBridge (cron-dispatcher) / NUC scheduler から定期的に呼ばれ、status='pending' の
// クラウドエクスポートを最大 limit 件 build して status='ready' (失敗時 'failed') にする。
//
// 使い方:
//   POST /api/cron/export-build   x-cron-secret: <CRON_SECRET>   Body(任意): { "limit": 5, "dryRun": true }
//   200 { ok, processed, ready, failed, reclaimed, skipped }
//   (#3509: reclaimed = build 中に kill/timeout し永久 stuck した stale 'building' を 'failed' へ
//    fail-closed (差し戻しでなく失敗確定) した件数。設計書 §3.2-4 が pending への自動差し戻しを不採用と
//    明記しているため、QM 2 回目 BLOCK 対応で 'failed' 遷移に是正済 = reclaimStaleBuildingExports の実装)
//   (#3695: skipped = 30 秒予算超過で今回 build せず次回 5 分毎 cron へ持ち越した件数)
//   401 Unauthorized / 404 secret 未設定 / 500 Internal Error

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import {
	drainPendingExports,
	previewPendingExports,
} from '$lib/server/services/cloud-export-service';
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
		// #4373: build はしないが、件数は定数ではなく実測 (pending 件数) を返す。
		// 定数を返すと「dryRun で 0 件だったので有効化して安全」という誤った判断を招く。
		return json({ ok: true, dryRun: true, ...(await previewPendingExports(limit)) });
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
// #4373: POST の dryRun と同じく件数は実測を返す (定数を返すと滞留を 0 件と誤報する)。
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;
	return json({ ok: true, dryRun: true, ...(await previewPendingExports(DEFAULT_LIMIT)) });
};
