// src/routes/api/cron/retention-cleanup/+server.ts
// #717, #729: 保存期間超過データの自動削除クロンエンドポイント
//
// EventBridge (Scheduled Rule) または手動実行から呼ばれる。
// 認証は OPS_SECRET_KEY の Bearer token で行う（OPS ダッシュボードと同じ鍵を共有）。
//
// 使い方:
//   POST /api/cron/retention-cleanup
//   Authorization: Bearer <OPS_SECRET_KEY>
//   Body (任意): { "dryRun": true }
//
// レスポンス:
//   200 { tenantsProcessed, childrenProcessed, activityLogsDeleted, ... }
//   401 Unauthorized
//   404 Not Found (OPS_SECRET_KEY 未設定時)
//   500 Internal Error

import { error, json } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { cleanupExpiredData } from '$lib/server/services/retention-cleanup-service';
import type { RequestHandler } from './$types';

function checkAuth(request: Request): void {
	const secret = process.env.OPS_SECRET_KEY;
	if (!secret) {
		// シークレット未設定 = エンドポイント無効化（存在を秘匿）
		error(404, 'Not Found');
	}

	const authHeader = request.headers.get('Authorization');
	if (authHeader !== `Bearer ${secret}`) {
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
		const result = await cleanupExpiredData({ dryRun });
		return json({
			ok: true,
			dryRun,
			...result,
		});
	} catch (e) {
		logger.error('[retention-cleanup] endpoint failed', {
			service: 'retention-cleanup',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 500 });
	}
};

// GET も許容（ヘルスチェック的用途。dry-run 実行）
export const GET: RequestHandler = async ({ request }) => {
	checkAuth(request);
	try {
		const result = await cleanupExpiredData({ dryRun: true });
		return json({
			ok: true,
			dryRun: true,
			...result,
		});
	} catch (e) {
		logger.error('[retention-cleanup] dry-run endpoint failed', {
			service: 'retention-cleanup',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 500 });
	}
};
