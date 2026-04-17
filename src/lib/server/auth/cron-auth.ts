// src/lib/server/auth/cron-auth.ts
// 共通 cron 認証ヘルパー — EventBridge / 手動トリガー用の内部エンドポイント認証

import { json } from '@sveltejs/kit';

/**
 * CRON_SECRET ヘッダによる内部 cron 認証を検証する。
 *
 * - CRON_SECRET が設定されている場合: x-cron-secret ヘッダと照合
 * - CRON_SECRET が未設定 かつ AUTH_MODE=local: 認証スキップ（ローカル開発用）
 * - CRON_SECRET が未設定 かつ AUTH_MODE≠local: 500 エラー
 *
 * @returns 認証失敗時は Response を返す。成功時は null。
 */
export function verifyCronAuth(request: Request): Response | null {
	const cronSecret = process.env.CRON_SECRET;
	if (cronSecret) {
		const authHeader = request.headers.get('x-cron-secret');
		if (authHeader !== cronSecret) {
			return json({ error: 'Unauthorized' }, { status: 401 }) as unknown as Response;
		}
	} else if (process.env.AUTH_MODE !== 'local') {
		return json({ error: 'CRON_SECRET not configured' }, { status: 500 }) as unknown as Response;
	}
	return null;
}
