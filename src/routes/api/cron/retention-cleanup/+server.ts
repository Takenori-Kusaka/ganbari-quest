// src/routes/api/cron/retention-cleanup/+server.ts
// #717, #729: 保存期間超過データの自動削除クロンエンドポイント
//
// EventBridge (Scheduled Rule) または手動実行から呼ばれる。
// 認証は CRON_SECRET の Bearer token で行う。
// #820 で /ops ダッシュボードは Cognito ops group 認可に移行したため、
// このエンドポイントは独自の shared secret (CRON_SECRET) を使う。
// 移行期間中は後方互換で OPS_SECRET_KEY も読み、どちらかが一致すれば許可する。
// ADR-0033 参照。
//
// 使い方:
//   POST /api/cron/retention-cleanup
//   Authorization: Bearer <CRON_SECRET>
//   Body (任意): { "dryRun": true }
//
// レスポンス:
//   200 { tenantsProcessed, childrenProcessed, activityLogsDeleted, ... }
//   401 Unauthorized
//   404 Not Found (CRON_SECRET / OPS_SECRET_KEY のいずれも未設定時)
//   500 Internal Error

import { error, json } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { cleanupExpiredData } from '$lib/server/services/retention-cleanup-service';
import type { RequestHandler } from './$types';

function checkAuth(request: Request): void {
	// #820 PR-D: CRON_SECRET を主とし、OPS_SECRET_KEY を後方互換フォールバックとして許可。
	// 本番 GitHub Secrets のローテーション完了後、OPS_SECRET_KEY サポートは削除予定。
	const cronSecret = process.env.CRON_SECRET;
	const legacySecret = process.env.OPS_SECRET_KEY;
	const accepted = [cronSecret, legacySecret].filter((v): v is string => !!v);
	if (accepted.length === 0) {
		// シークレット未設定 = エンドポイント無効化（存在を秘匿）
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
