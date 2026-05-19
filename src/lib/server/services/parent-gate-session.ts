// src/lib/server/services/parent-gate-session.ts
// EPIC #2310 子#2313: Parent-Gate Session 機構
//
// PIN 認証後の short-lived signed cookie session を管理。
// - ADR-0050: cookie-signature 採用 (OSS 4 件比較)
// - NIST SP 800-63B-4 AAL1: 15 分 inactivity sliding timeout
// - OWASP Session Management Cheat Sheet 整合
//
// cookie payload (JSON.stringify → cookie-signature.sign):
//   { tenantId, verifiedAt, lastActiveAt }
// cookie name: 'gq_parent_session'

import cookieSignature from 'cookie-signature';
import { logger } from '$lib/server/logger';

/** PIN 認証後 session の inactivity timeout (15 分、NIST SP 800-63B-4 AAL1 推奨) */
export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

/** session hard max (24 時間、cookie maxAge と一致) */
export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

/** session cookie 名 (#2310 EPIC SSOT) */
export const PARENT_SESSION_COOKIE_NAME = 'gq_parent_session';

/** cookie 署名キー env var */
const SECRET_ENV_VAR = 'PARENT_GATE_COOKIE_SECRET';
/** dev 環境 fallback secret (production では throw する) */
const DEV_FALLBACK_SECRET = 'dev-parent-gate-secret-DO-NOT-USE-IN-PROD';

/** cookie payload schema */
export interface ParentSessionPayload {
	tenantId: string;
	verifiedAt: number; // unix ms
	lastActiveAt: number; // unix ms
}

function getSecret(): string {
	const secret = process.env[SECRET_ENV_VAR];
	if (secret && secret.length >= 16) return secret;

	// production で未設定なら throw (誤って弱い fallback で署名する事故を防ぐ)
	const isProd = process.env.NODE_ENV === 'production' && !process.env.VITEST;
	if (isProd) {
		throw new Error(
			`[PARENT_GATE] ${SECRET_ENV_VAR} env var is required in production (length >= 16)`,
		);
	}
	// dev / test では fallback secret + 警告ログ
	if (!secret) {
		logger.warn(`[PARENT_GATE] ${SECRET_ENV_VAR} not set, using dev fallback (dev/test only)`);
	}
	return DEV_FALLBACK_SECRET;
}

/**
 * 新 session 発行: payload を JSON 化 → base64 → cookie-signature.sign で署名
 *
 * @param tenantId テナント ID (検証時の整合性チェック用)
 * @returns 署名済 cookie 値 (httpOnly cookie の value にそのまま入れる)
 */
export function createParentSession(tenantId: string): string {
	const now = Date.now();
	const payload: ParentSessionPayload = {
		tenantId,
		verifiedAt: now,
		lastActiveAt: now,
	};
	const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
	return cookieSignature.sign(encoded, getSecret());
}

/** payload を parse (検証込み)、不正なら null */
function parseSignedPayload(cookie: string | undefined): ParentSessionPayload | null {
	if (!cookie) return null;
	const unsigned = cookieSignature.unsign(cookie, getSecret());
	if (unsigned === false) return null;

	try {
		const decoded = Buffer.from(unsigned, 'base64').toString('utf8');
		const obj = JSON.parse(decoded);
		if (
			typeof obj !== 'object' ||
			obj === null ||
			typeof obj.tenantId !== 'string' ||
			typeof obj.verifiedAt !== 'number' ||
			typeof obj.lastActiveAt !== 'number'
		) {
			return null;
		}
		return obj as ParentSessionPayload;
	} catch {
		return null;
	}
}

/**
 * session 検証: 署名・テナント整合・timeout を確認
 *
 * @param cookie cookie 値 (cookies.get('gq_parent_session') の結果)
 * @param tenantId 現在のテナント ID (cookie 内テナントと一致必須)
 * @returns true なら有効、false なら無効 (未認証 / 失効 / 改ざん / テナント跨ぎ)
 */
export function verifyParentSession(
	cookie: string | undefined,
	tenantId: string | undefined,
): boolean {
	if (!tenantId) return false;
	const payload = parseSignedPayload(cookie);
	if (!payload) return false;

	// テナント跨ぎ攻撃検出
	if (payload.tenantId !== tenantId) {
		logger.warn('[PARENT_GATE] tenant_id mismatch in session cookie', {
			context: { cookieTenantId: payload.tenantId, requestTenantId: tenantId },
		});
		return false;
	}

	const now = Date.now();
	// inactivity sliding timeout
	if (now - payload.lastActiveAt > INACTIVITY_TIMEOUT_MS) return false;
	// hard max
	if (now - payload.verifiedAt > MAX_SESSION_MS) return false;

	return true;
}

/**
 * sliding refresh: lastActiveAt を更新して再 sign
 *
 * 前提: 呼び出し前に verifyParentSession で有効性確認済
 * 呼び出し後: 返り値の新 cookie 値を cookies.set で再発行する
 *
 * @param cookie 既存 cookie 値
 * @returns 更新済 cookie 値 (parse 失敗時 null)
 */
export function refreshParentSession(cookie: string | undefined): string | null {
	const payload = parseSignedPayload(cookie);
	if (!payload) return null;

	const refreshed: ParentSessionPayload = {
		...payload,
		lastActiveAt: Date.now(),
	};
	const encoded = Buffer.from(JSON.stringify(refreshed), 'utf8').toString('base64');
	return cookieSignature.sign(encoded, getSecret());
}
