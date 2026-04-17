// src/lib/server/auth/cron-auth.ts
// Cron エンドポイント共通の認証ヘルパー (#1033)
//
// EventBridge / 手動呼び出しから利用される cron エンドポイントで
// 共通の Bearer token 認証を行う。
// CRON_SECRET を主とし、OPS_SECRET_KEY を後方互換フォールバックとして許可。
// #820 PR-D: 本番 GitHub Secrets のローテーション完了後、OPS_SECRET_KEY サポートは削除予定。

import { error } from '@sveltejs/kit';

/**
 * Cron エンドポイントの認証チェック。
 *
 * CRON_SECRET / OPS_SECRET_KEY のいずれかが Authorization: Bearer ヘッダに
 * 一致すれば OK。両方未設定の場合はエンドポイント自体を 404 として秘匿する。
 *
 * @throws HttpError 401 認証失敗
 * @throws HttpError 404 シークレット未設定（エンドポイント無効化）
 */
export function verifyCronAuth(request: Request): void {
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
