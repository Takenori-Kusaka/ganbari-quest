// src/routes/api/cron/retention-cleanup/+server.ts
// #717, #729: 保存期間超過データの自動削除クロンエンドポイント
//
// EventBridge (Scheduled Rule) または手動実行から呼ばれる。
// 認証は x-cron-secret ヘッダで行う（verifyCronAuth 共通ヘルパー）。
//
// 使い方:
//   POST /api/cron/retention-cleanup
//   x-cron-secret: <CRON_SECRET>
//   Body (任意): { "dryRun": true }
//
// レスポンス:
//   200 { tenantsProcessed, childrenProcessed, activityLogsDeleted, ... }
//   401 Unauthorized
//   404 Not Found (CRON_SECRET / OPS_SECRET_KEY のいずれも未設定時)
//   500 Internal Error

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { cleanupExpiredData } from '$lib/server/services/retention-cleanup-service';
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

	logger.info('[retention-cleanup] endpoint started', {
		service: 'retention-cleanup',
		context: { dryRun },
	});

	try {
		const result = await cleanupExpiredData({ dryRun });
		logger.info('[retention-cleanup] endpoint completed', {
			service: 'retention-cleanup',
			context: {
				dryRun,
				tenantsProcessed: result.tenantsProcessed,
				childrenProcessed: result.childrenProcessed,
				activityLogsDeleted: result.activityLogsDeleted,
			},
		});
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
		// #4867 adversarial: cron の response body は `infra/lambda/cron-dispatcher` が
		// 先頭 200 文字を `console.log` するので、生の message を返すと **CloudWatch に出る**
		// (log group が app 側から dispatcher 側へ移るだけ)。ADR-0062 §2 の
		// 「`err.message` をそのままレスポンスに載せない」もこれを禁じている。
		// 原因は上の logger.error に残し、レスポンスは固定文言にする
		// (この endpoint の呼び手は cron dispatcher だけで人間向け UI は無い)。
		return json({ ok: false, error: 'retention cleanup failed' }, { status: 500 });
	}
};

// GET も許容（ヘルスチェック的用途。dry-run 実行）
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;
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
		// #4867 adversarial: cron の response body は `infra/lambda/cron-dispatcher` が
		// 先頭 200 文字を `console.log` するので、生の message を返すと **CloudWatch に出る**
		// (log group が app 側から dispatcher 側へ移るだけ)。ADR-0062 §2 の
		// 「`err.message` をそのままレスポンスに載せない」もこれを禁じている。
		// 原因は上の logger.error に残し、レスポンスは固定文言にする
		// (この endpoint の呼び手は cron dispatcher だけで人間向け UI は無い)。
		return json({ ok: false, error: 'retention cleanup failed' }, { status: 500 });
	}
};
