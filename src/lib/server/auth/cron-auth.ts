// src/lib/server/auth/cron-auth.ts
// 共通 cron 認証ヘルパー — EventBridge / 手動トリガー用の内部エンドポイント認証
//
// #1377 (Sub A-3): cron-dispatcher Lambda は `Authorization: Bearer <CRON_SECRET>`
// で POST する一方、本ヘルパーは元々 `x-cron-secret` ヘッダのみを受け入れていた。
// その結果 AWS dispatcher 経由の retention-cleanup / trial-notifications が
// 401 で silent fail していた可能性が高い (license-expire は独自 checkAuth で
// `Authorization: Bearer` を見ていたため通っていた)。
//
// 修正方針: 両ヘッダを受け入れる。NUC scheduler (`scripts/scheduler.ts`) は
// 既に両ヘッダを送るが、AWS dispatcher は Authorization: Bearer のみ。
// OPS_SECRET_KEY は ADR-0033 後方互換 (compute-stack.ts L79-L88 参照)。

import { json } from '@sveltejs/kit';

/**
 * CRON_SECRET / OPS_SECRET_KEY による内部 cron 認証を検証する。
 *
 * 認証ヘッダは以下のいずれかが受理される (どちらが届いても OK):
 *   - `x-cron-secret: <CRON_SECRET>`              (NUC scheduler / 既存テスト)
 *   - `Authorization: Bearer <CRON_SECRET>`        (AWS cron-dispatcher / license-expire 互換)
 *
 * `OPS_SECRET_KEY` は ADR-0033 後方互換のため CRON_SECRET と同等扱い。
 *
 * 動作:
 * - 設定済み + ヘッダ一致: 認証成功 (null を返す)
 * - 設定済み + ヘッダ不一致: 401
 * - 未設定 + AUTH_MODE=local (or 未設定): 認証スキップ (ローカル開発)
 * - 未設定 + AUTH_MODE≠local: 500 (本番設定ミス検出)
 *
 * @returns 認証失敗時は Response を返す。成功時は null。
 */
export function verifyCronAuth(request: Request): Response | null {
	const cronSecret = process.env.CRON_SECRET;
	const legacySecret = process.env.OPS_SECRET_KEY;
	const accepted = [cronSecret, legacySecret].filter((v): v is string => !!v);

	if (accepted.length === 0) {
		// CRON_SECRET / OPS_SECRET_KEY 共に未設定。
		// AUTH_MODE=local (ローカル開発) のときだけ skip。production 等は 500 で検出する。
		if (process.env.AUTH_MODE !== 'local') {
			return json({ error: 'CRON_SECRET not configured' }, { status: 500 }) as unknown as Response;
		}
		return null;
	}

	// 両ヘッダを許容 (#1377 Sub A-3): NUC は x-cron-secret、AWS dispatcher は Authorization: Bearer
	const xCronSecret = request.headers.get('x-cron-secret');
	const authHeader = request.headers.get('Authorization');
	const bearerMatch = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

	const authorized = accepted.some((s) => xCronSecret === s || bearerMatch === s);
	if (!authorized) {
		return json({ error: 'Unauthorized' }, { status: 401 }) as unknown as Response;
	}
	return null;
}
