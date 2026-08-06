// src/routes/api/cron/age-recalc/+server.ts
// #1381: 子供の年齢自動インクリメント cron エンドポイント (Sub B-3)
//
// EventBridge (Scheduled Rule, 日次 JST 00:00) または手動実行から呼ばれる。
// 認証は x-cron-secret ヘッダで行う（verifyCronAuth 共通ヘルパー）。
//
// 使い方:
//   POST /api/cron/age-recalc
//   x-cron-secret: <CRON_SECRET>
//   Body (任意): { "dryRun": true }
//
// レスポンス:
//   200 { ok: true, scanned, skipped, updated, failures, dryRun,
//         tenantsTotal, tenantsProcessed, tenantsRemaining,
//         tenantsSkippedByRotation, tenantsSkippedByBudget,
//         budgetExceeded, sliceIndex, sliceCount }
//   401 Unauthorized
//   500 Internal Error
//
// #4337 (13-AWS設計書 §3.3): 1 回の実行は件数上限 + 20 秒予算で self-limiting する。
// 走査しきれなかったテナントは tenantsRemaining として報告され、次回以降の実行が回収する。
// #4345 follow-up: tenantsRemaining は「今日の担当外（ローテーション、正常）」
// (tenantsSkippedByRotation) と「担当スライス内での打ち切り（予算超過、異常）」
// (tenantsSkippedByBudget) の合算。前者はテナント数が tenantLimit を超える定常状態で
// 毎日発生しうる設計どおりの値、後者だけが warn の対象（実装は age-recalc-service.ts 参照）。

import { json } from '@sveltejs/kit';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { recalcAllChildrenAges } from '$lib/server/services/age-recalc-service';
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
		const result = await recalcAllChildrenAges({ dryRun });
		logger.info('[age-recalc] completed', {
			service: 'age-recalc',
			...result,
		});
		return json({ ok: true, ...result });
	} catch (e) {
		logger.error('[age-recalc] endpoint failed', {
			service: 'age-recalc',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 500 });
	}
};

// GET も許容（ヘルスチェック的用途。dry-run 実行）
export const GET: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;
	try {
		const result = await recalcAllChildrenAges({ dryRun: true });
		return json({ ok: true, ...result });
	} catch (e) {
		logger.error('[age-recalc] dry-run endpoint failed', {
			service: 'age-recalc',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, { status: 500 });
	}
};
