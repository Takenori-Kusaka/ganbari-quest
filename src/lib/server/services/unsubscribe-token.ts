// src/lib/server/services/unsubscribe-token.ts
// #1601: 配信停止トークン (HMAC-SHA256)。
//
// 特定電子メール法 + IETF RFC 8058 (List-Unsubscribe One-Click) に対応するため、
// メール本文と List-Unsubscribe ヘッダの両方で同一トークンを使う。
//
// セキュリティ:
//   - 鍵は OPS_SECRET_KEY を流用 (Pre-PMF シンプル化、ADR-0010)。
//     専用鍵 MARKETING_UNSUBSCRIBE_SECRET を新設しない方針 (鍵配布経路を増やさない)。
//   - トークンは <tenantId>.<emailKind>.<sig> 形式。emailKind は marketing/system 等。
//   - 改竄検知のため必ず HMAC で検証する。expiry は付けない (List-Unsubscribe は
//     生涯有効が望ましい、特電法準拠)。
//   - 鍵未設定 (`OPS_SECRET_KEY` も `CRON_SECRET` も無い) ローカル環境では
//     dev fallback secret を使う。production guard は呼び出し側 (compute-stack.ts) で担保。

import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from '$lib/runtime/env';

// ============================================================
// 内部ヘルパ
// ============================================================

function getSigningSecret(): string {
	const env = getEnv();
	const secret = env.OPS_SECRET_KEY ?? env.CRON_SECRET;
	if (secret && secret.length > 0) return secret;
	if (env.AUTH_MODE === 'local') {
		// ローカル開発時のみの dev fallback。production では compute-stack.ts が
		// `cronSecret || opsSecretKey` を保証するため到達しない。
		return 'local-dev-unsubscribe-secret';
	}
	throw new Error(
		'[unsubscribe-token] OPS_SECRET_KEY (or CRON_SECRET) is required in non-local environments',
	);
}

function base64UrlEncode(input: Buffer): string {
	return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload: string): string {
	const hmac = createHmac('sha256', getSigningSecret());
	hmac.update(payload);
	return base64UrlEncode(hmac.digest());
}

// ============================================================
// Public API
// ============================================================

/** unsubscribe トークンが対象とするメール種別 */
export type UnsubscribeKind = 'marketing' | 'system';

export interface UnsubscribeTokenPayload {
	tenantId: string;
	kind: UnsubscribeKind;
}

/** トークン生成。`<tenantId>.<kind>.<sig>` 形式。 */
export function generateUnsubscribeToken(payload: UnsubscribeTokenPayload): string {
	const { tenantId, kind } = payload;
	if (!tenantId) throw new Error('[unsubscribe-token] tenantId is required');
	if (tenantId.includes('.')) {
		throw new Error('[unsubscribe-token] tenantId must not contain "." (delimiter conflict)');
	}
	const body = `${tenantId}.${kind}`;
	return `${body}.${sign(body)}`;
}

/**
 * トークン検証 + decode。
 *
 * @returns 検証成功時は payload、失敗時は null。例外は投げない (入力は外部由来)。
 */
export function verifyUnsubscribeToken(token: string): UnsubscribeTokenPayload | null {
	if (!token || typeof token !== 'string') return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [tenantId, kind, sig] = parts;
	if (!tenantId || !kind || !sig) return null;
	if (kind !== 'marketing' && kind !== 'system') return null;

	const expected = sign(`${tenantId}.${kind}`);
	const expectedBuf = Buffer.from(expected);
	const actualBuf = Buffer.from(sig);
	if (expectedBuf.length !== actualBuf.length) return null;
	if (!timingSafeEqual(expectedBuf, actualBuf)) return null;

	return { tenantId, kind };
}
